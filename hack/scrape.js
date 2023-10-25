#!/usr/bin/env deno run --allow-net

import entities from "./entities.json" assert { type: "json" };

const fetchJson = (...a) => fetch(...a).then((r) => r.json());

// const sensorsEndpoint = new URL(
//   "https://newcastle.urbanobservatory.ac.uk/api/v1.1/sensors/json"
// );
// sensorsEndpoint.searchParams.set("bbox_p1_x", "-1.625851");
// sensorsEndpoint.searchParams.set("bbox_p1_y", "54.973940");
// sensorsEndpoint.searchParams.set("bbox_p2_x", "-1.624362");
// sensorsEndpoint.searchParams.set("bbox_p2_y", "54.973125");
// const sensors = await fetchJson(sensorsEndpoint);
//
// console.log(JSON.stringify(sensors));

const output = [];

for (const entity of entities) {
  // console.debug("fetching %o", entity.name);

  const data = await fetchJson(
    `https://api.usb.urbanobservatory.ac.uk/api/v2/sensors/entity/${entity.id}`,
  );

  const metrics = {};

  for (const feed of data.feed) {
    metrics[feed.metric] = {
      feedId: feed.feedId,
      timeseriesIds: feed.timeseries.map((t) => t.timeseriesId),
    };
  }

  output.push({
    ...entity,
    metrics,
  });
}

console.log(JSON.stringify(output));
