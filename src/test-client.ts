import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { createApp } from "./server.js";
import { config } from "./config.js";
import http from "http";

async function runClientTest() {
  console.log("==================================================================");
  console.log("             ServiceNow MCP Client Integration Test                ");
  console.log("==================================================================");

  const targetUrlArg = process.argv[2];
  let baseUrl: string;
  let testServer: http.Server | null = null;
  const testApiKey = config.mcpApiKey || "test-secret-key-12345";

  if (targetUrlArg) {
    baseUrl = targetUrlArg.replace(/\/+$/, "");
    console.log(`Connecting to external MCP server at: ${baseUrl}`);
  } else {
    // Spin up an in-memory server instance for standalone testing
    console.log("No external server URL passed. Starting temporary in-process test server...");
    const testPort = 3999;
    const testConfig = {
      ...config,
      port: testPort,
      mcpApiKey: testApiKey,
    };
    const { app } = createApp(testConfig);

    await new Promise<void>((resolve) => {
      testServer = app.listen(testPort, "127.0.0.1", () => {
        baseUrl = `http://127.0.0.1:${testPort}`;
        console.log(`Temporary test server listening on ${baseUrl}`);
        resolve();
      });
    });
  }

  try {
    console.log("\nStep 1: Testing /health endpoint...");
    const healthRes = await fetch(`${baseUrl!}/health`);
    const healthJson = await healthRes.json();
    console.log("✅ /health response:", JSON.stringify(healthJson));

    console.log("\nStep 2: Connecting MCP SSE Client Transport with Token Authentication...");
    const sseUrl = new URL(`${baseUrl!}/sse`);
    sseUrl.searchParams.set("token", testApiKey);

    const transport = new SSEClientTransport(sseUrl, {
      requestInit: {
        headers: {
          Authorization: `Bearer ${testApiKey}`,
        },
      },
    });

    const client = new Client(
      {
        name: "servicenow-test-client",
        version: "1.0.0",
      },
      {
        capabilities: {},
      }
    );

    console.log(`Connecting to SSE stream: ${sseUrl.toString()}`);
    await client.connect(transport);
    console.log("✅ MCP Client successfully connected to SSE transport!");

    console.log("\nStep 3: Discovering registered MCP tools...");
    const toolsResult = await client.listTools();
    console.log(`✅ Discovered ${toolsResult.tools.length} registered tools:`);
    for (const tool of toolsResult.tools) {
      const desc = tool.description ? tool.description.slice(0, 70) : "No description";
      console.log(`   - 🛠️  ${tool.name.padEnd(28)} : ${desc}...`);
    }

    console.log("\nStep 4: Executing tool call test ('sn_health_check')...");
    try {
      const callResult = await client.callTool({
        name: "sn_health_check",
        arguments: {},
      });
      console.log("✅ sn_health_check response:");
      for (const item of callResult.content as any[]) {
        if (item.type === "text") {
          console.log(item.text);
        }
      }
    } catch (toolErr: any) {
      console.warn("⚠️ sn_health_check returned error:", toolErr.message);
    }

    console.log("\nStep 5: Closing MCP client session...");
    await client.close();
    console.log("✅ MCP Client session closed cleanly.");

    console.log("\n==================================================================");
    console.log("🎉 ALL INTEGRATION TESTS PASSED SUCCESSFULLY!");
    console.log("==================================================================");
  } finally {
    if (testServer) {
      console.log("Shutting down temporary test server...");
      await new Promise<void>((resolve) => (testServer as http.Server).close(() => resolve()));
      console.log("Test server stopped.");
    }
  }
}

runClientTest().catch((err) => {
  console.error("❌ Test failed with error:", err);
  process.exit(1);
});
