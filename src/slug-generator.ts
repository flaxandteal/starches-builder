import { slugify } from 'alizarin';

export class SlugGenerator {
  slugCounter: {[key: string]: number} = {};

  async toSlug(title: string, staticAsset: any, prefix: string | undefined): Promise<string> {
    let slug = slugify(title);
    slug = `${slug}-${staticAsset.id.slice(0, 6)}`;
    if (prefix) {
      slug = `${prefix}${slug}`;
    }
    let slug_n;
    if (slug in this.slugCounter) {
      slug_n = this.slugCounter[slug] + 1;
      slug = `${slug}-${slug_n}`;
    } else {
      slug_n = 1;
    }
    this.slugCounter[slug] = slug_n;
    return slug;
  }

  reset() {
    this.slugCounter = {};
  }
}
