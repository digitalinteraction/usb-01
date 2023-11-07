import svgURL from "./usb-01.svg";
import floor from "./floor.json" assert { type: "json" };
import { ColorInterpolator } from "./color-interpolator.js";
import { PointImageInterpolator } from "./point-image-interpolator.js";

/**
  @typedef {Object} Point
  @property {number} x
  @property {number} y
  @property {number | null | undefined} value
  @property {HTMLElement} element
*/

/**
  @typedef {Object} ZoneRecord
  @property {PointImageInterpolator} interpolator
  @property {HTMLElement} elem
  @property {Point[]} points
  @property {(typeof floor)['spaces'][number]} space
  @property {Function} draw
  @property {Point} point
  @property {(typeof floor)['spaces'][number]['zones'][number]} zone
*/

/** @type {SVGScriptElement} */
let svg = null;

const UO_BASE =
  location.hostname === "localhost"
    ? new URL("http://localhost:8080/api/v2/")
    : new URL("https://api.usb.urbanobservatory.ac.uk/api/v2/");

const canvas = document.getElementById("canvas");

/** @type {HTMLDialogElement} */
const popup = document.getElementById("popup");

/** @type {HTMLSelectField} */
const metric = document.getElementById("metric");

let isFetching = false;

const noValueColour = "transparent";

/** @type {keyof typeof gradients} */
let currentMetric = "room-temperature";

/** @type {Map<string, HTMLElement>} */
const rooms = new Map();

/** @type {Map<string, ZoneRecord>} */
const zones = new Map();

const gradients = {
  "room-temperature": createGradient(
    [
      { offset: 0, color: "#663399" },
      { offset: 16, color: "#82c3d0" },
      { offset: 18, color: "#ABCE82" },
      { offset: 20, color: "#FECB01" },
      { offset: 22, color: "#FC7F0A" },
      { offset: 24, color: "#fd3814" },
      { offset: 42.5, color: "#770600" },
    ],
    [15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25],
  ),
  "occupancy-sensor": createGradient(
    [
      { offset: 0, color: "#0c087a" },
      { offset: 1, color: "#74e7ee" },
    ],
    [0, 1],
  ),

  // https://www.kane.co.uk/knowledge-centre/what-are-safe-levels-of-co-and-co2-in-rooms
  co2: createGradient(
    [
      { offset: 0, color: "#FFFFFF" },
      { offset: 400, color: "#00FF00" },
      { offset: 700, color: "#0000FF" },
      { offset: 1_000, color: "#FF0000" },
    ],
    [0, 500, 1000, 1500, 2000, 5000],
  ),
};

function debounce(ms, fn) {
  let timerId = null;
  return () => {
    if (timerId) clearTimeout(timerId);
    timerId = setTimeout(() => {
      timerId = null;
      fn();
    }, ms);
  };
}

function createGradient(stops, legend, numSteps = 1024) {
  const colors = new ColorInterpolator(stops);
  const lookup = colors.createLookup(numSteps);
  return { colors, lookup, legend };
}

async function main() {
  svg = new DOMParser()
    .parseFromString(await fetch(svgURL).then((r) => r.text()), "image/svg+xml")
    .querySelector("svg");

  canvas.appendChild(svg);

  for (const room of floor.rooms) {
    const elem = svg.querySelector(room.floorSelector);
    if (!elem) {
      console.error("room not found", room.floorSelector);
      continue;
    }
    rooms.set(room.entityId, elem);
    elem.addEventListener("click", (e) => onRoomClick(room, e));
  }

  // spaces
  for (const space of floor.spaces) {
    const elem = svg.querySelector(space.floorSelector);

    if (!elem) {
      console.error("room not found", space.floorSelector);
      continue;
    }

    const points = PointImageInterpolator.extractGroupSiblingPoints(
      elem,
      "circle",
    );
    const interpolator = new PointImageInterpolator(elem);

    const record = {
      interpolator,
      elem,
      points,
      space,
      draw: debounce(500, () => interpolator.draw()),
    };

    for (const zone of space.zones) {
      for (const point of points) {
        // not great...
        if ("#" + point.element.id === zone.selector) {
          zones.set(zone.entityId, { ...record, point, zone });
        }
      }
    }
  }

  drawLegend();

  metric.addEventListener("input", async () => {
    currentMetric = metric.value;
    drawLegend();
    await fetchData();
    // TODO: should fetches be in a Q?
  });

  svg.addEventListener("click", (e) => {
    const rect = e.target.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    console.log(x, y, e.target.id);
  });

  await fetchData();
  setInterval(() => fetchData(), 60_000);
}

function drawLegend() {
  const ul = document.getElementById("legend");
  ul.innerHTML = "";
  ul.setAttribute("role", "list");

  const { colors, legend } = gradients[currentMetric];

  for (const i of legend) {
    const li = ul.appendChild(document.createElement("li"));
    const colour = li.appendChild(document.createElement("span"));
    li.appendChild(document.createTextNode(`${i}`));

    colour.classList.add("legendColour");
    colour.style.setProperty(
      "--colour",
      ColorInterpolator.toColorString(colors.interpolateColor(i)),
    );
  }
}

async function fetchEntity(entityId) {
  const res = await fetch(
    new URL(`./sensors/entity/${entityId}`, UO_BASE),
  ).catch(() => null);

  if (!res?.ok) {
    console.error("fetch entity failed: " + res.statusText);
    return null;
  }

  return res.json();
}

async function fetchFeed(feedId) {
  const res = await fetch(new URL(`./sensors/feed/${feedId}`, UO_BASE)).catch(
    () => null,
  );

  if (!res?.ok) {
    console.error("fetch feed failed: " + res.statusText);
    return null;
  }

  return res.json();
}

async function fetchData() {
  if (isFetching) return;
  isFetching = true;

  for (const room of floor.rooms) {
    if (!room.feeds[currentMetric]) continue;
    const data = await fetchFeed(room.feeds[currentMetric]);
    if (data) onFeedData(room.entityId, data);
  }

  for (const space of floor.spaces) {
    for (const zone of space.zones) {
      if (!zone.feeds[currentMetric]) continue;
      const data = await fetchFeed(zone.feeds[currentMetric]);
      if (data) onFeedData(zone.entityId, data);
    }
  }
  isFetching = false;
}

async function onFeedData(entityId, data) {
  let elem = rooms.get(entityId);
  const room = floor.rooms.find((r) => r.entityId === entityId);
  const zone = zones.get(entityId);
  const latest = data.timeseries?.[0]?.latest?.value;

  const { colors, lookup } = gradients[currentMetric];

  if (elem && room) {
    console.log(elem.id, latest);

    if (latest) {
      elem.setAttribute(
        "fill",
        ColorInterpolator.toColorString(colors.interpolateColor(latest)),
      );
      elem.setAttribute("title", latest);
    } else {
      elem.setAttribute("fill", noValueColour);
      elem.setAttribute("title", "No value");
    }
  }

  if (zone) {
    console.debug(zone.zone.selector, latest);

    if (typeof latest === "number") {
      zone.point.value = latest;
      zone.interpolator.update(zone.points, lookup);
      zone.draw();
    } else {
      zone.point.value = null;
    }
  }
}

/** @param {(typeof floor)['rooms'][number]} room */
async function onRoomClick(room) {
  const entity = await fetchEntity(room.entityId);
  if (!entity) return;

  const label = document.querySelector(room.labelSelector);

  const rows = [];
  for (const feedId of Object.values(room.feeds)) {
    const feed = entity.feed.find((f) => f.feedId === feedId);
    const value = feed.timeseries[0]?.latest?.value;
    const unit = feed.timeseries[0]?.unit?.name;

    if (/occupancy/i.test(feed.metric)) {
      rows.push(`<dt>${feed.metric}</dt>`);
      rows.push(`<dd>${value ? "Yes" : "No"}</dd>`);
    } else if (value) {
      rows.push(`<dt>${feed.metric}</dt>`);
      rows.push(`<dd>${value} ${unit ?? ""}</dd>`);
    } else {
      // rows.push(`<dd>no value</dd>`);
    }
  }

  // popup.open = true;
  popup.showModal();
  popup.innerHTML = `
    <h2>${label?.textContent ?? entity.name ?? "Room"}</h2>
    <dl>${rows.join("\n")}</dl>
    <cluster-layout class="toolbar">
      <form method="dialog">
        <button>Close</button>
      </form>
    </cluster-layout>
  `;

  popup.querySelector("button").addEventListener("click", (e) => {
    e.preventDefault();
    popup.close();
  });
}

main().catch((e) => console.error("fatal error", e));
