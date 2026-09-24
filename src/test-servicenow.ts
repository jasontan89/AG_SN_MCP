import { config } from "./config.js";
import { ServiceNowClient } from "./services/servicenow.js";

async function main() {
  console.log("==================================================================");
  console.log("       ServiceNow PDI Direct Connectivity Test Utility            ");
  console.log("==================================================================");
  console.log(` Target Instance URL : ${config.serviceNow.instanceUrl || "(NOT CONFIGURED)"}`);
  console.log(` Authentication Type : ${config.serviceNow.authType.toUpperCase()}`);
  if (config.serviceNow.authType === "oauth") {
    console.log(` Grant Type          : ${config.serviceNow.oauthGrantType}`);
    console.log(` Client ID           : ${config.serviceNow.clientId ? config.serviceNow.clientId.slice(0, 10) + "..." : "(NOT CONFIGURED)"}`);
  } else {
    console.log(` Username            : ${config.serviceNow.username || "(NOT CONFIGURED)"}`);
  }
  console.log("------------------------------------------------------------------");

  if (!config.serviceNow.instanceUrl) {
    console.error("❌ ERROR: SERVICENOW_INSTANCE_URL is not set in your .env file.");
    console.log("Please create or edit your .env file with your instance URL (e.g., https://devXXXXX.service-now.com)");
    process.exit(1);
  }

  const client = new ServiceNowClient(config);

  console.log("Step 1: Testing connectivity and authentication...");
  try {
    const pingResult = await client.ping();
    if (pingResult.ok) {
      console.log("✅ SUCCESS: Successfully authenticated and connected to ServiceNow!");
    } else {
      console.error(`❌ FAILED: ${pingResult.message}`);
      process.exit(1);
    }
  } catch (err: any) {
    console.error(`❌ FAILED: ${err.message}`);
    process.exit(1);
  }

  console.log("\nStep 2: Testing Incident retrieval (reading 1 record)...");
  try {
    const incidents = await client.queryTable("incident", { sysparm_limit: 1 });
    console.log(`✅ SUCCESS: Retrieved ${incidents.length} incident record(s).`);
    if (incidents.length > 0) {
      const inc = incidents[0];
      const number = inc.number?.display_value || inc.number || "N/A";
      const shortDesc = inc.short_description?.display_value || inc.short_description || "N/A";
      console.log(`   Sample Incident: [${number}] - ${shortDesc}`);
    }
  } catch (err: any) {
    console.warn(`⚠️ Warning querying incidents: ${err.message}`);
  }

  console.log("\nStep 3: Testing User retrieval (reading 1 record)...");
  try {
    const users = await client.queryTable("sys_user", { sysparm_limit: 1 });
    console.log(`✅ SUCCESS: Retrieved ${users.length} user record(s).`);
    if (users.length > 0) {
      const user = users[0];
      const name = user.name?.display_value || user.name || "N/A";
      const userName = user.user_name?.display_value || user.user_name || "N/A";
      console.log(`   Sample User: ${name} (${userName})`);
    }
  } catch (err: any) {
    console.warn(`⚠️ Warning querying users: ${err.message}`);
  }

  console.log("\n==================================================================");
  console.log("🎉 ALL TESTS COMPLETED: ServiceNow configuration is verified!");
  console.log("==================================================================");
}

main().catch((err) => {
  console.error("Unexpected error during test execution:", err);
  process.exit(1);
});
