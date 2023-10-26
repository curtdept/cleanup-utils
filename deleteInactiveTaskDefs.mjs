import {
  ECSClient,
  ListTaskDefinitionsCommand,
  paginateListTaskDefinitions,
  DescribeTaskDefinitionCommand,
  DeleteTaskDefinitionsCommand,
} from "@aws-sdk/client-ecs";
import { fromSSO } from "@aws-sdk/credential-providers";

const awsRegion = "us-west-2";

const client = new ECSClient({
  region: awsRegion,
  credentials: fromSSO({ profile: "legacy-stage" }),
  maxAttempts: 100,
});

async function main() {
  let defs = new Set();

  const fList = await client.send(
    new ListTaskDefinitionsCommand({
      status: "INACTIVE",
    })
  );

  // console.log(fList);

  for await (const data of paginateListTaskDefinitions(
    { client },
    {
      nextToken: fList.nextToken,
      status: "INACTIVE",
    }
  )) {
    for (const def of data.taskDefinitionArns) {
      console.log("removing:", def);
      await client.send(
        new DeleteTaskDefinitionsCommand({
          taskDefinitions: [def],
        })
      );
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
  });
