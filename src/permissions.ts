import { RDM, GraphManager, staticTypes, interfaces } from 'alizarin';

export class PermissionManager {
  permissions: {[key: string]: {[key: string]: boolean | string} | boolean} = {};
  permissionCollectionNodes: {[key: string]: {[alias: string]: staticTypes.StaticCollection | undefined}} = {};
  permissionFunctions: {[key: string]: interfaces.CheckPermission} = {};

  setPermissions(permissions: {[key: string]: {[key: string]: boolean | string} | boolean}) {
    this.permissions = permissions;
  }

  getPermittedNodegroups(modelName: string) {
    if (!this.permissions[modelName]) {
      return null;
    }
    return new Map(Object.entries(this.permissions[modelName]).map(([k, v]: [k: string, v: string | boolean]) => {
      if (typeof v === "boolean") {
        return [k, v];
      }
      return [k, this.permissionFunctions[v]];
    }));
  }

  async initializeCollectionNodes(modelClassName: string, nodes: Map<string, staticTypes.StaticNode>) {
    if (modelClassName in this.permissionCollectionNodes) {
      for (const [alias] of Object.entries(this.permissionCollectionNodes[modelClassName])) {
        const node = nodes.get(alias);
        if (node) {
          this.permissionCollectionNodes[modelClassName][alias] = await RDM.retrieveCollection(node.config.rdmCollection);
        }
      }
    }
  }

  async applyPermissions(Model: any, modelClassName: string, includePrivate: boolean) {
    if (includePrivate) {
      // When including private data, allow all nodegroups
      Model.setDefaultAllowAllNodegroups(true);
    } else {
      if (modelClassName in this.permissions && this.permissions[modelClassName] !== false) {
        if (this.permissions[modelClassName] !== true) {
          await this.initializeCollectionNodes(modelClassName, Model.getNodeObjectsByAlias());
          Model.setPermittedNodegroups(this.getPermittedNodegroups(modelClassName));
        }
      } else {
        Model.setPermittedNodegroups([]);
      }
    }
  }
}
