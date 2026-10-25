import type { RequestHandler } from "express";
import { pipelineWithCounts, replaceStages } from "../crm/pipeline.js";
import * as s from "../crm/schemas.js";
import { HttpError, parse } from "../http.js";

export const getPipeline: RequestHandler = (_req, res) => {
  res.json(pipelineWithCounts());
};

export const savePipeline: RequestHandler = (req, res) => {
  const { stages } = parse(s.pipelineBody, req.body);
  const problem = replaceStages(stages);
  if (problem) throw new HttpError(409, problem);
  res.json(pipelineWithCounts());
};
