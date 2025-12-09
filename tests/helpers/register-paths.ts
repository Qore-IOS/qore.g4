import path from "path";

// Cast to any to safely hook into the private resolver
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Module: any = require("module");

const originalResolveFilename = Module._resolveFilename.bind(Module);

Module._resolveFilename = function (request: string, parent: any, isMain: boolean, options: any) {
  if (request.startsWith("@/")) {
    const resolvedPath = path.join(process.cwd(), ".test-dist", "src", request.slice(2));
    return originalResolveFilename(resolvedPath, parent, isMain, options);
  }

  return originalResolveFilename(request, parent, isMain, options);
};
