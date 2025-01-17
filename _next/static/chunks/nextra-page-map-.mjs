import meta from "../../../src/pages/_meta.ts";
import installation_meta from "../../../src/pages/installation/_meta.ts";
export const pageMap = [{
  data: meta
}, {
  name: "index",
  route: "/",
  frontMatter: {
    "sidebarTitle": "Index"
  }
}, {
  name: "installation",
  route: "/installation",
  children: [{
    data: installation_meta
  }, {
    name: "source",
    route: "/installation/source",
    frontMatter: {
      "sidebarTitle": "Source"
    }
  }, {
    name: "vscode",
    route: "/installation/vscode",
    frontMatter: {
      "sidebarTitle": "Vscode"
    }
  }, {
    name: "vscodium",
    route: "/installation/vscodium",
    frontMatter: {
      "sidebarTitle": "Vscodium"
    }
  }]
}];