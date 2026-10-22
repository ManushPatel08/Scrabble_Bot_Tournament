import { parentPort, workerData } from "node:worker_threads";
import { runSlice, type BatchSpec } from "./batch.ts";
import "./strategies.ts"; // registers the final strategy and its versions

const { spec, from, to } = workerData as { spec: BatchSpec; from: number; to: number };
parentPort!.postMessage(runSlice(spec, from, to));
