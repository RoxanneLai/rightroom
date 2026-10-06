import { runPmAcceptance } from "../lib/ingestion/pm-acceptance.ts";
import { errorCode } from "../lib/ingestion/errors.ts";

async function main(): Promise<void> {
  try {
    await runPmAcceptance(process.argv.slice(2), process.env, (value) =>
      console.log(JSON.stringify(value, null, 2)),
    );
  } catch (error) {
    console.error(
      "PM discovery stopped: " +
        errorCode(error) +
        ". No automatic retries; see docs/PM-DISCOVERY-PREPARATION.md.",
    );
    process.exitCode = 1;
  }
}

await main();
