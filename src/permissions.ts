/**
 * Conditional permission rule for filtering tiles by data values.
 * Tiles are permitted if the value at `path` is in the `allowed` set.
 */
export interface ConditionalPermission {
  /** JSON path to evaluate (e.g., ".data.uuid.field.name") */
  path: string;
  /** Set of allowed values - tile is permitted if value at path is in this set */
  allowed: string[];
}

/** Permission value: boolean or conditional rule */
export type PermissionValue = boolean | ConditionalPermission;

/** Model-level permissions: false to deny all, true to allow all, or nodegroup map */
export type ModelPermissions = boolean | {[nodegroupId: string]: PermissionValue};

export class PermissionManager {
  permissions: {[key: string]: ModelPermissions} = {};

  setPermissions(permissions: {[key: string]: ModelPermissions}) {
    // Validate permissions before setting
    this.validatePermissions(permissions);
    this.permissions = permissions;
  }

  /**
   * Validate permission rules and throw an error if any are invalid.
   */
  private validatePermissions(permissions: {[key: string]: ModelPermissions}) {
    const errors: string[] = [];

    for (const [modelName, modelPerms] of Object.entries(permissions)) {
      if (typeof modelPerms === 'boolean') {
        continue; // Valid boolean model permission
      }

      if (typeof modelPerms !== 'object' || modelPerms === null) {
        errors.push(`Invalid permission for model '${modelName}': expected boolean or object`);
        continue;
      }

      // Validate nodegroup permissions
      for (const [nodegroupId, value] of Object.entries(modelPerms)) {
        if (typeof value === 'boolean') {
          continue; // Valid boolean nodegroup permission
        }

        if (typeof value !== 'object' || value === null) {
          errors.push(`Invalid permission value for '${modelName}.${nodegroupId}': expected boolean or {path, allowed} object`);
          continue;
        }

        // Validate conditional permission
        const cond = value as ConditionalPermission;

        if (!('path' in cond)) {
          errors.push(`Invalid conditional rule for '${modelName}.${nodegroupId}': 'path' key is required`);
        } else if (typeof cond.path !== 'string') {
          errors.push(`Invalid conditional rule for '${modelName}.${nodegroupId}': 'path' must be a string`);
        } else if (!cond.path) {
          errors.push(`Invalid conditional rule for '${modelName}.${nodegroupId}': 'path' cannot be empty`);
        }

        if (!('allowed' in cond)) {
          errors.push(`Invalid conditional rule for '${modelName}.${nodegroupId}': 'allowed' key is required`);
        } else if (!Array.isArray(cond.allowed)) {
          errors.push(`Invalid conditional rule for '${modelName}.${nodegroupId}': 'allowed' must be an array`);
        } else if (cond.allowed.length === 0) {
          errors.push(`Invalid conditional rule for '${modelName}.${nodegroupId}': 'allowed' array cannot be empty`);
        } else {
          for (let i = 0; i < cond.allowed.length; i++) {
            if (typeof cond.allowed[i] !== 'string') {
              errors.push(`Invalid conditional rule for '${modelName}.${nodegroupId}': 'allowed[${i}]' must be a string`);
            }
          }
        }
      }
    }

    if (errors.length > 0) {
      throw new Error(`Permission validation errors:\n  - ${errors.join('\n  - ')}`);
    }
  }

  getPermittedModels(): string[] {
    /**
     * Note that this will return models for which we do not explicitly say `false` as the permission list
     */
    const entries: [string, ModelPermissions][] = Object.entries(this.permissions);
    return entries.map((value: [string, ModelPermissions]) => {
      if (value[1] !== false) {
        return value[0];
      }
    }).filter(key => key !== undefined);
  }

  getPermittedNodegroups(modelName: string): Map<string, PermissionValue> | null {
    if (!this.permissions[modelName]) {
      return null;
    }
    const modelPerms = this.permissions[modelName];
    if (typeof modelPerms === 'boolean') {
      return null; // Let caller handle boolean model permissions
    }

    // Pass values directly - alizarin handles both boolean and conditional
    return new Map(Object.entries(modelPerms));
  }

  async applyPermissions(Model: any, modelClassName: string, includePrivate: boolean) {
    if (includePrivate) {
      // When including private data, allow all nodegroups
      Model.setDefaultAllowAllNodegroups(true);
    } else {
      if (modelClassName in this.permissions && this.permissions[modelClassName] !== false) {
        if (this.permissions[modelClassName] !== true) {
          const permittedNodegroups = this.getPermittedNodegroups(modelClassName);
          Model.setPermittedNodegroups(permittedNodegroups);
        }
        // If permissions[modelClassName] === true, do nothing (allows all by default)
      } else {
        // No permissions defined - deny all
        Model.setPermittedNodegroups(new Map());
      }
    }
  }
}
