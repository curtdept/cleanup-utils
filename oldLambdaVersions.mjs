import {
  DeleteFunctionCommand,
  LambdaClient,
  ListAliasesCommand,
  ListFunctionsCommand,
  paginateListVersionsByFunction,
} from "@aws-sdk/client-lambda";
import { fromSSO } from "@aws-sdk/credential-providers";

//Delete all but 'keepversions' highest numbered numeric versions
const keepversions = 3;
const awsRegion = "us-west-2";

const client = new LambdaClient({
  region: awsRegion,
  credentials: fromSSO({ profile: "stage" }),
});

async function main() {
  const fList = await client.send(
    new ListFunctionsCommand({ region: awsRegion }),
  );

  for (let func of fList.Functions) {
    let resVer = [];

    for await (const data of paginateListVersionsByFunction(
      { client },
      { FunctionName: func.FunctionName },
    )) {
      resVer.push(...(data.Versions ?? []));
    }

    let verList = new Set();

    for (const row of resVer) {
      if (row.Version != "$LATEST" && !Number.isNaN(row.Version))
        verList.add(Number(row.Version));
    }

    let resAlias = await client.send(
      new ListAliasesCommand({ FunctionName: func.FunctionArn }),
    );

    for (const row of resAlias.Aliases) {
      if (
        row.FunctionVersion != "$LATEST" &&
        !Number.isNaN(row.FunctionVersion)
      ) {
        verList.delete(Number(row.FunctionVersion));
      }
    }

    let remVerList = Array.from(
      new Int32Array(verList.values()).sort().reverse(),
    );

    remVerList.splice(0, keepversions);

    for (const row of remVerList) {
      const arn = `${func.FunctionArn}:${row}`;
      console.log("removing:", arn);
      await client.send(
        new DeleteFunctionCommand({
          FunctionName: arn,
        }),
      );
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
  });
