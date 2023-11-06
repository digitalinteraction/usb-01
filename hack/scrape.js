#!/usr/bin/env deno run --allow-net

import data from "./floor.json" assert { type: "json" };

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

// https://github.com/digitalinteraction/deconf-api-toolkit/blob/d1bac26e4090e9c2c0c3f8f9d3eadaa63fb07fc4/src/pretalx/pretalx-service.ts#L232
function getSlug(input) {
  return input
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^\w-]+/g, "")
    .replace(/-+/g, "-");
}

async function getFeeds(entityId) {
  const data = await fetchJson(
    `https://api.usb.urbanobservatory.ac.uk/api/v2/sensors/entity/${entityId}`,
  );

  const feeds = {};
  for (const feed of data.feed) {
    feeds[getSlug(feed.metric)] = feed.feedId;
  }
  return feeds;
}

for (const room of data.rooms) {
  room.feeds = await getFeeds(room.entityId);
}

for (const space of data.spaces) {
  for (const zone of space.zones) {
    zone.feeds = await getFeeds(zone.entityId);
  }
}

console.log(JSON.stringify(data, null, 2));
