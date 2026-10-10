// Built-in example diagrams, for trying the tutor without a Stella file.
// The model id is the "id" field inside its JSON file.
import { ModelGraph, type ModelData } from "../engine";
import deerPopulation from "./deer-population.json";
import waterSupply from "./water-supply.json";

const DATA = [deerPopulation, waterSupply] as ModelData[];

export const MODELS = new Map<string, ModelGraph>(DATA.map((d) => [d.id, new ModelGraph(d)]));
