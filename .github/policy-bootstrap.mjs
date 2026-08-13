import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";

const EXPECTED_PACKAGE = {
  name: "@openboa-ai/eval-policy-parser",
  private: true,
  version: "1.0.0",
  dependencies: { yaml: "2.9.0" },
};
const EXPECTED_LOCK = {
  name: "@openboa-ai/eval-policy-parser",
  version: "1.0.0",
  lockfileVersion: 3,
  requires: true,
  packages: {
    "": {
      name: "@openboa-ai/eval-policy-parser",
      version: "1.0.0",
      dependencies: { yaml: "2.9.0" },
    },
    "node_modules/yaml": {
      version: "2.9.0",
      resolved: "https://registry.npmjs.org/yaml/-/yaml-2.9.0.tgz",
      integrity:
        "sha512-2AvhNX3mb8zd6Zy7INTtSpl1F15HW6Wnqj0srWlkKLcpYl/gMIMJiyuGq2KeI2YFxUPjdlB+3Lc10seMLtL4cA==",
      bin: { yaml: "bin.mjs" },
      engines: { node: ">= 14.6" },
      funding: { url: "https://github.com/sponsors/eemeli" },
    },
  },
};

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new TypeError(
      `${label} must be authenticated before loading: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

export function authenticatePolicyParser(repositoryRoot) {
  const parserRoot = resolve(repositoryRoot, ".github/policy-parser");
  if (existsSync(resolve(parserRoot, "npm-shrinkwrap.json"))) {
    throw new TypeError(
      "isolated policy parser npm-shrinkwrap.json must be absent before loading",
    );
  }
  const packageJson = readJson(
    resolve(parserRoot, "package.json"),
    "isolated policy parser package",
  );
  const lock = readJson(
    resolve(parserRoot, "package-lock.json"),
    "isolated policy parser lock",
  );
  if (
    !isDeepStrictEqual(packageJson, EXPECTED_PACKAGE) ||
    !isDeepStrictEqual(lock, EXPECTED_LOCK)
  ) {
    throw new TypeError(
      "isolated policy parser lock must be authenticated before loading",
    );
  }
  return parserRoot;
}

export function loadPolicyParser(repositoryRoot) {
  const parserRoot = authenticatePolicyParser(repositoryRoot);
  const policyRequire = createRequire(resolve(parserRoot, "package.json"));
  const expectedModuleRoot = resolve(parserRoot, "node_modules/yaml");
  const moduleRootStat = lstatSync(expectedModuleRoot);
  const realModuleRoot = realpathSync(expectedModuleRoot);
  const resolvedModule = realpathSync(policyRequire.resolve("yaml"));
  const moduleRelativePath = relative(realModuleRoot, resolvedModule);
  if (
    moduleRootStat.isSymbolicLink() ||
    !moduleRootStat.isDirectory() ||
    moduleRelativePath === ".." ||
    moduleRelativePath.startsWith(`..${sep}`) ||
    isAbsolute(moduleRelativePath)
  ) {
    throw new TypeError(
      "isolated policy parser must resolve inside its authenticated install",
    );
  }
  return policyRequire("yaml");
}

const repositoryRoot = resolve(
  process.env.EVAL_CI_POLICY_ROOT ??
    resolve(dirname(fileURLToPath(import.meta.url)), ".."),
);
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  authenticatePolicyParser(repositoryRoot);
  process.stdout.write("Policy parser lock authenticated\n");
}
