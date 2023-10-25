#!/usr/bin/env deno run --allow-net --watch
import { green, yellow } from "https://deno.land/std@0.204.0/fmt/colors.ts";

const socket = new WebSocket("wss://api.usb.urbanobservatory.ac.uk/stream");
socket.addEventListener("message", (event) => {
  const { entity, feed, timeseries } = JSON.parse(event.data).data;

  if (!entity?.name || !feed?.metric) return;
  if (entity?.meta?.buildingFloor !== "1") return;

  console.log(
    entity.name.replace("Urban Sciences Building: ", ""),
    green(feed.metric),
    yellow(timeseries.value.data.toString()),
    timeseries.unit === "no units" ? "" : timeseries.unit,
  );
});
