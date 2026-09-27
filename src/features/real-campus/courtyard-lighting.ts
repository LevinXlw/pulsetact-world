// A fixed early-autumn afternoon study, not a reconstruction of capture time.
// One palette drives the visible sky, ambient fill, sunlight and fog.
export const courtyardLighting = {
  sun: {color:'#fff1dc',intensity:3.05,offset:[-112,145,108] as const},
  fill: {sky:'#dae7f0',ground:'#8c8775',intensity:1.12},
  sky: {horizon:'#c8dce7',zenith:'#6b9fc1',cloud:'#edf0ed'},
  fog: {color:'#c8dce7',near:480,far:1400},
  exposure:1.02,
} as const;
