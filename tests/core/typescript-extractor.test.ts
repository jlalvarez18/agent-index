import { describe, expect, test } from "vitest";
import type { SourceFile } from "../../src/core/schema.js";
import { extractTypeScript, typeScriptExtractor } from "../../src/core/extractors/typescript.js";

function sourceFile(text: string, relativePath = "src/views/DashboardScreen.tsx"): SourceFile {
  return {
    absolutePath: `/repo/${relativePath}`,
    relativePath,
    language: "typescript",
    role: "source",
    text
  };
}

function testSourceFile(text: string, relativePath = "src/client/api.test.ts"): SourceFile {
  return {
    ...sourceFile(text, relativePath),
    role: "test"
  };
}

describe("extractTypeScript", () => {
  test("advertises modern TypeScript and JavaScript module extensions", () => {
    expect(typeScriptExtractor.extensions).toEqual([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]);
  });

  test("extracts exported functions, arrow components, classes, methods, imports, and calls", () => {
    const result = extractTypeScript(
      sourceFile(`import { invoke } from "@tauri-apps/api/core";
import { useProjectStore } from "../stores/projectStore";

export type PhaseStatus = "todo" | "done";

export function detectCurrentPhase(phases: PhaseStatus[]) {
  return phases.find((phase) => phase !== "done");
}

export const DashboardScreen = () => {
  const setPhases = useProjectStore((state) => state.setPhases);
  invoke("get_roadmap").then(setPhases);
  return null;
};

class PhaseController {
  async refresh() {
    return detectCurrentPhase(["todo"]);
  }
}
`)
    );

    expect(result.symbols.map((symbol) => ({
      name: symbol.name,
      qualifiedName: symbol.qualifiedName,
      kind: symbol.kind,
      parentSymbolName: symbol.parentSymbolName
    }))).toEqual([
      {
        name: "src/views/DashboardScreen.tsx",
        qualifiedName: "src/views/DashboardScreen.tsx",
        kind: "module",
        parentSymbolName: undefined
      },
      {
        name: "PhaseStatus",
        qualifiedName: "PhaseStatus",
        kind: "class",
        parentSymbolName: "src/views/DashboardScreen.tsx"
      },
      {
        name: "detectCurrentPhase",
        qualifiedName: "detectCurrentPhase",
        kind: "function",
        parentSymbolName: "src/views/DashboardScreen.tsx"
      },
      {
        name: "DashboardScreen",
        qualifiedName: "DashboardScreen",
        kind: "function",
        parentSymbolName: "src/views/DashboardScreen.tsx"
      },
      {
        name: "PhaseController",
        qualifiedName: "PhaseController",
        kind: "class",
        parentSymbolName: "src/views/DashboardScreen.tsx"
      },
      {
        name: "refresh",
        qualifiedName: "PhaseController.refresh",
        kind: "method",
        parentSymbolName: "PhaseController"
      }
    ]);
    expect(result.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceSymbolName: "src/views/DashboardScreen.tsx",
          targetName: "@tauri-apps/api/core",
          kind: "symbol_imports_module"
        }),
        expect.objectContaining({
          sourceSymbolName: "DashboardScreen",
          targetName: "invoke",
          kind: "symbol_calls_name"
        }),
        expect.objectContaining({
          sourceSymbolName: "PhaseController.refresh",
          targetName: "detectCurrentPhase",
          kind: "symbol_calls_name"
        })
      ])
    );
  });

  test("extracts React wrappers, object methods, class fields, default config exports, and CommonJS exports", () => {
    const result = extractTypeScript(
      sourceFile(
        `import { defineConfig } from "vite";
const stripe = require("stripe");
export { CheckoutProvider } from "./CheckoutProvider";
export * from "./generated/payment-types";

export const PaymentButton = React.memo(function PaymentButtonImpl() {
  import("./PaymentDialog").then((module) => module.PaymentDialog);
  return <button>Pay</button>;
});

export const payments = {
  async list(params) {
    return stripe.customers.list(params);
  },
  create: async (params) => {
    return stripe.customers.create(params);
  }
};

class CheckoutClient {
  static fromKey(key: string) {
    return new CheckoutClient(key);
  }

  refresh = async () => {
    return payments.list({});
  };
}

export default defineConfig({
  test: { environment: "jsdom" }
});

exports.auditExactString = function auditExactString() {
  return "X-Agent-Trace";
};

Axios.prototype.request = function request(config) {
  return this.dispatchRequest(config);
};
`,
        "src/payments/checkout.jsx"
      )
    );

    expect(result.file.language).toBe("typescript");
    expect(result.symbols.map((symbol) => ({
      name: symbol.name,
      qualifiedName: symbol.qualifiedName,
      kind: symbol.kind,
      parentSymbolName: symbol.parentSymbolName
    }))).toEqual(
      expect.arrayContaining([
        {
          name: "PaymentButton",
          qualifiedName: "PaymentButton",
          kind: "function",
          parentSymbolName: "src/payments/checkout.jsx"
        },
        {
          name: "payments",
          qualifiedName: "payments",
          kind: "class",
          parentSymbolName: "src/payments/checkout.jsx"
        },
        {
          name: "list",
          qualifiedName: "payments.list",
          kind: "method",
          parentSymbolName: "payments"
        },
        {
          name: "create",
          qualifiedName: "payments.create",
          kind: "method",
          parentSymbolName: "payments"
        },
        {
          name: "fromKey",
          qualifiedName: "CheckoutClient.fromKey",
          kind: "method",
          parentSymbolName: "CheckoutClient"
        },
        {
          name: "refresh",
          qualifiedName: "CheckoutClient.refresh",
          kind: "method",
          parentSymbolName: "CheckoutClient"
        },
        {
          name: "default",
          qualifiedName: "default",
          kind: "function",
          parentSymbolName: "src/payments/checkout.jsx"
        },
        {
          name: "auditExactString",
          qualifiedName: "auditExactString",
          kind: "function",
          parentSymbolName: "src/payments/checkout.jsx"
        },
        {
          name: "request",
          qualifiedName: "Axios.request",
          kind: "method",
          parentSymbolName: "Axios"
        }
      ])
    );
    expect(result.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceSymbolName: "src/payments/checkout.jsx",
          targetName: "vite",
          kind: "symbol_imports_module"
        }),
        expect.objectContaining({
          sourceSymbolName: "src/payments/checkout.jsx",
          targetName: "stripe",
          kind: "symbol_imports_module"
        }),
        expect.objectContaining({
          sourceSymbolName: "src/payments/checkout.jsx",
          targetName: "./CheckoutProvider",
          kind: "symbol_imports_module"
        }),
        expect.objectContaining({
          sourceSymbolName: "src/payments/checkout.jsx",
          targetName: "./generated/payment-types",
          kind: "symbol_imports_module"
        }),
        expect.objectContaining({
          sourceSymbolName: "src/payments/checkout.jsx",
          targetName: "./PaymentDialog",
          kind: "symbol_imports_module"
        }),
        expect.objectContaining({
          sourceSymbolName: "payments.list",
          targetName: "list",
          kind: "symbol_calls_name"
        }),
        expect.objectContaining({
          sourceSymbolName: "CheckoutClient.refresh",
          targetName: "list",
          kind: "symbol_calls_name"
        })
      ])
    );
  });

  test("extracts typed and generic TypeScript function forms used by clients and build tooling", () => {
    const result = extractTypeScript(
      sourceFile(
        `export async function loadConfig<TOptions extends UserConfig>(options: TOptions): Promise<ResolvedConfig> {
  return resolveConfig(options);
}

export const createClient: ClientFactory = async <TRequest extends RequestOptions>(
  request: TRequest
): Promise<Client<TRequest>> => {
  return buildClient(request);
};

export default (config: UserConfig): ResolvedConfig => {
  return normalizeConfig(config);
};

export const sdk = {
  traceMethod<TResponse>(method: string): Promise<TResponse> {
    return dispatch(method);
  },
  listPayments: async <TParams extends PaymentListParams>(
    params: TParams
  ): Promise<Payment[]> => {
    return transport.get("/payments", params);
  }
};

class ApiClient {
  request<TResponse>(config: RequestConfig): Promise<TResponse> {
    return dispatchRequest(config);
  }

  send: SendFunction = async <TBody>(body: TBody): Promise<Response> => {
    return post(body);
  };
}

export const createSlice = /* @__PURE__ */ buildCreateSlice();
`,
        "src/client/api.ts"
      )
    );

    expect(result.symbols.map((symbol) => ({
      name: symbol.name,
      qualifiedName: symbol.qualifiedName,
      kind: symbol.kind,
      parentSymbolName: symbol.parentSymbolName
    }))).toEqual(
      expect.arrayContaining([
        {
          name: "loadConfig",
          qualifiedName: "loadConfig",
          kind: "function",
          parentSymbolName: "src/client/api.ts"
        },
        {
          name: "createClient",
          qualifiedName: "createClient",
          kind: "function",
          parentSymbolName: "src/client/api.ts"
        },
        {
          name: "default",
          qualifiedName: "default",
          kind: "function",
          parentSymbolName: "src/client/api.ts"
        },
        {
          name: "traceMethod",
          qualifiedName: "sdk.traceMethod",
          kind: "method",
          parentSymbolName: "sdk"
        },
        {
          name: "listPayments",
          qualifiedName: "sdk.listPayments",
          kind: "method",
          parentSymbolName: "sdk"
        },
        {
          name: "request",
          qualifiedName: "ApiClient.request",
          kind: "method",
          parentSymbolName: "ApiClient"
        },
        {
          name: "send",
          qualifiedName: "ApiClient.send",
          kind: "method",
          parentSymbolName: "ApiClient"
        },
        {
          name: "createSlice",
          qualifiedName: "createSlice",
          kind: "function",
          parentSymbolName: "src/client/api.ts"
        }
      ])
    );
    expect(result.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceSymbolName: "loadConfig",
          targetName: "resolveConfig",
          kind: "symbol_calls_name"
        }),
        expect.objectContaining({
          sourceSymbolName: "ApiClient.request",
          targetName: "dispatchRequest",
          kind: "symbol_calls_name"
        })
      ])
    );
  });

  test("extracts JS and TS test cases as compact test symbols", () => {
    const result = extractTypeScript(
      testSourceFile(`import { createClient } from "./api";

describe("createClient", () => {
  test("createClient forwards options", () => {
    expect(createClient({ baseUrl: "/" }).options.baseUrl).toBe("/");
  });

  it.only("merges default config", async () => {
    expect(await createClient({ timeout: 10 })).toBeTruthy();
  });

  test.each([
    ["/api"],
    ["/rpc"]
  ])("createClient forwards base url %s", (baseUrl) => {
    expect(createClient({ baseUrl }).options.baseUrl).toBe(baseUrl);
  });
});
`)
    );

    expect(result.symbols.map((symbol) => ({
      name: symbol.name,
      qualifiedName: symbol.qualifiedName,
      kind: symbol.kind,
      parentSymbolName: symbol.parentSymbolName
    }))).toEqual(
      expect.arrayContaining([
        {
          name: "test_createClient_forwards_options",
          qualifiedName: "test_createClient_forwards_options",
          kind: "function",
          parentSymbolName: "src/client/api.test.ts"
        },
        {
          name: "test_merges_default_config",
          qualifiedName: "test_merges_default_config",
          kind: "function",
          parentSymbolName: "src/client/api.test.ts"
        },
        {
          name: "test_createClient_forwards_base_url_s",
          qualifiedName: "test_createClient_forwards_base_url_s",
          kind: "function",
          parentSymbolName: "src/client/api.test.ts"
        }
      ])
    );
    expect(result.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceSymbolName: "test_createClient_forwards_options",
          targetName: "createClient",
          kind: "symbol_calls_name"
        }),
        expect.objectContaining({
          sourceSymbolName: "test_merges_default_config",
          targetName: "createClient",
          kind: "symbol_calls_name"
        }),
        expect.objectContaining({
          sourceSymbolName: "test_createClient_forwards_base_url_s",
          targetName: "createClient",
          kind: "symbol_calls_name"
        })
      ])
    );
  });
});
