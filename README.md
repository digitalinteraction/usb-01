# usb-01

This project is a visualisation of the Urban Sciences Building first floor using the [Urban Observatory](https://newcastle.urbanobservatory.ac.uk) API.

## How it works

The visualisation is based on an SVG floor plan of the first floor, where Open Lab is.
The SVG is enhanced with JavaScript using the [JSON floor data](./source/floor.json) which maps parts of the SVG into rooms and spaces.

Rooms are individual places on the floor with a single sensor.
The room's background colour is set by fetching the latest data for the currently selected metric, interpolating that into a colour and setting it as the background colour.
This uses [color-interpolator](./source/color-interpolator.js) to do the interpolation based on presets from the selected metric.

Spaces are made up of multiple zones each with their own sensors. The space's is turned into a [Voronoi diagram](https://en.wikipedia.org/wiki/Voronoi_diagram) using [voronoi.js](./source/voronoi.js) and then each zone in the diagram is interpolated with the latest sensor data's interpolated colour using [point-image-interpolator.js](./source/point-image-interpolator.js).

## Development

To play about with the repo, check it out on your local machine.

```sh
# cd to/this/repo

# Run the development server
# -> Starts a local HTTP server on http://localhost:5173/
npm run start

# Build production version
npm run build

# Build & preview production version 
npm run build
```

## Deployment

To push changes, commit and push them to the `main` branch and GitHub will do the rest.
It will build the site and deploy it to GitHub pages.
