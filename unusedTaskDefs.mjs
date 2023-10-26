import {
  ECSClient,
  ListTaskDefinitionsCommand,
  paginateListTaskDefinitions,
  ListTasksCommand,
  paginateListTasks,
  ListClustersCommand,
  paginateListClusters,
  DescribeTasksCommand,
  ListServicesCommand,
  paginateListServices,
  DescribeServicesCommand,
  DeregisterTaskDefinitionCommand,
  DescribeTaskDefinitionCommand,
} from "@aws-sdk/client-ecs";
import { fromSSO } from "@aws-sdk/credential-providers";
import arn from "@aws-sdk/util-arn-parser";

const numToKeep = 5;
const awsRegion = "us-west-2";
const whiteList = ["us-west-2-jenkins-slave", "us-west-2-jenkins-kaniko"];

const client = new ECSClient({
  region: awsRegion,
  credentials: fromSSO({ profile: "legacy-stage" }),
  maxAttempts: 100,
});

async function main() {
  let clusters = new Set();
  let defs = new Set();
  let taskArns = new Map();
  let runningTaskArns = new Set();
  let serviceArns = new Map();
  let serviceTaskArns = new Set();
  let otherArns = new Map();

  const cList = await client.send(
    new ListClustersCommand({ region: awsRegion }),
  );

  for await (const data of paginateListClusters(
    { client },
    { nextToken: cList.nextToken },
  )) {
    for (const cluster of data.clusterArns) {
      clusters.add(cluster);
    }
  }

  for (const cluster of clusters.values()) {
    const tList = await client.send(
      new ListTasksCommand({ region: awsRegion, cluster }),
    );

    for await (const data of paginateListTasks(
      { client },
      { nextToken: tList.nextToken, cluster },
    )) {
      for (const task of data.taskArns) {
        taskArns.set(task, { cluster, taskArn: task });
      }
    }
  }

  for (const task of taskArns.values()) {
    const tDesc = await client.send(
      new DescribeTasksCommand({
        region: awsRegion,
        tasks: [task.taskArn],
        cluster: task.cluster,
      }),
    );

    for (const t of tDesc.tasks) {
      runningTaskArns.add(t.taskDefinitionArn);
    }
  }

  for (const cluster of clusters.values()) {
    const tList = await client.send(
      new ListServicesCommand({ region: awsRegion, cluster }),
    );

    for await (const data of paginateListServices(
      { client },
      { nextToken: tList.nextToken, cluster },
    )) {
      for (const service of data.serviceArns) {
        serviceArns.set(service, { cluster, serviceArn: service });
      }
    }
  }

  for (const service of serviceArns.values()) {
    const sDesc = await client.send(
      new DescribeServicesCommand({
        region: awsRegion,
        services: [service.serviceArn],
        cluster: service.cluster,
      }),
    );

    for (const s of sDesc.services) {
      serviceTaskArns.add(s.taskDefinition);
    }
  }

  const fList = await client.send(
    new ListTaskDefinitionsCommand({ region: awsRegion }),
  );

  for await (const data of paginateListTaskDefinitions(
    { client },
    { nextToken: fList.nextToken },
  )) {
    for (const def of data.taskDefinitionArns) {
      defs.add(def);
    }
  }

  console.log("start", defs.size);

  for (const td of defs) {
    if (serviceTaskArns.has(td) || runningTaskArns.has(td)) {
      defs.delete(td);
    }

    for (const w of whiteList) {
      if (td.includes(w)) {
        defs.delete(td);

        const tDef = await client.send(
          new DescribeTaskDefinitionCommand({
            region: awsRegion,
            taskDefinition: td,
          }),
        );

        if (otherArns.has(tDef.taskDefinition.family)) {
          let row = otherArns.get(tDef.taskDefinition.family);
          row.add(td);
          otherArns.set(tDef.taskDefinition.family, row);
        } else {
          let row = new Set();
          row.add(td);
          otherArns.set(tDef.taskDefinition.family, row);
        }
      }
    }
  }

  console.log("end", defs.size);

  for (const key of otherArns.keys()) {
    const rows = otherArns.get(key);

    if (!rows || rows.size < 1) continue;

    const rowArray = Array.from(rows.values());
    const first = rowArray[0];
    const fParsed = arn.parse(first);
    const prefix = "".concat(
      "arn:",
      fParsed.partition,
      ":",
      fParsed.service,
      ":",
      fParsed.region,
      ":",
      fParsed.accountId,
      ":",
      fParsed.resource.substring(0, fParsed.resource.indexOf(":")),
    );

    let vers = new Set();

    for (const r of rowArray) {
      const p = arn.parse(r);
      const v = Number(
        p.resource.substring(
          fParsed.resource.indexOf(":") + 1,
          p.resource.length,
        ),
      );
      vers.add(v);
    }

    let sortedVers = Array.from(new Int32Array(vers.values()).sort().reverse());

    sortedVers.splice(0, numToKeep);

    for (const v of sortedVers) {
      const vArn = prefix.concat(":", v);
      defs.add(vArn);
    }
  }

  for (const t of defs.values()) {
    console.log("removing:", t);
    await client.send(
      new DeregisterTaskDefinitionCommand({
        region: awsRegion,
        taskDefinition: t,
      }),
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
  });
