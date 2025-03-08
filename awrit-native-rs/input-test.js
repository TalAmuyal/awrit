const {
  termEnableFeatures,
  listenForInput,
  termDisableFeatures,
} = require("./index");
const util = require("node:util");

const features = termEnableFeatures();

console.log = (...data) => process.stderr.write(`\r\n${util.formatWithOptions({ colors: true }, ...data).trim().replace(/\n/g, "\n\r")}`);

const { promise: block, resolve: unblock } = Promise.withResolvers();

setTimeout(() => {
  try {
    unblock();
  } catch (e) { }
}, 1000000000);

async function main() {
  console.log(features);
  listenForInput((y, x) => {
    if (y) return;

    console.log("\r", x);
    if (x.keyEvent?.code === "c" && x.keyEvent?.modifiers.includes("ctrl"))
      unblock();
  }, 200);
  await block;
  termDisableFeatures(features);
}

main();
