import { HazardsSummary } from "@/lib/hazards";

export type RiskBreakdown = {
  earthquake: number;
  wildfire: number;
  severeStorm: number;
  volcano: number;
  flood: number;
  landslide: number;
  drought: number;
  overall: number;
};

export function poissonProbability(expectedEventsPerPeriod: number): number {
  // Probability of at least one event in the period: 1 - e^{-lambda}
  const lambda = Math.max(0, expectedEventsPerPeriod);
  return 1 - Math.exp(-lambda);
}

export function computeRisk(summary: HazardsSummary): RiskBreakdown {
  const years = Math.max(1, summary.lookbackYears);

  const eqPerYear = summary.counts.earthquakes / years;
  const eqProb = poissonProbability(eqPerYear);

  const cat = summary.counts.eonetByCategory;
  const wildfirePerYear = (cat["Wildfires"] ?? 0) / years;
  const severeStormPerYear = ((cat["Severe Storms"] ?? 0) + (cat["Tropical Cyclones"] ?? 0)) / years;
  const volcanoPerYear = (cat["Volcanoes"] ?? 0) / years;
  const floodPerYear = (cat["Floods"] ?? 0) / years;
  const landslidePerYear = (cat["Landslides"] ?? 0) / years;
  const droughtPerYear = (cat["Drought"] ?? 0) / years;

  const wildfireProb = poissonProbability(wildfirePerYear);
  const stormProb = poissonProbability(severeStormPerYear);
  const volcanoProb = poissonProbability(volcanoPerYear);
  const floodProb = poissonProbability(floodPerYear);
  const landslideProb = poissonProbability(landslidePerYear);
  const droughtProb = poissonProbability(droughtPerYear);

  // Weighted overall risk (weights sum to 1)
  const weights = {
    earthquake: 0.30,
    wildfire: 0.15,
    severeStorm: 0.20,
    volcano: 0.05,
    flood: 0.20,
    landslide: 0.05,
    drought: 0.05,
  };

  const overall =
    eqProb * weights.earthquake +
    wildfireProb * weights.wildfire +
    stormProb * weights.severeStorm +
    volcanoProb * weights.volcano +
    floodProb * weights.flood +
    landslideProb * weights.landslide +
    droughtProb * weights.drought;

  return {
    earthquake: eqProb,
    wildfire: wildfireProb,
    severeStorm: stormProb,
    volcano: volcanoProb,
    flood: floodProb,
    landslide: landslideProb,
    drought: droughtProb,
    overall,
  };
}

export function summarizeAdvice(risk: RiskBreakdown): { business: string; home: string; level: "low" | "moderate" | "high" } {
  let level: "low" | "moderate" | "high";
  if (risk.overall < 0.2) level = "low";
  else if (risk.overall < 0.5) level = "moderate";
  else level = "high";

  const business =
    level === "low"
      ? "Favorable: proceed with normal due diligence. Maintain basic insurance."
      : level === "moderate"
      ? "Caution: proceed with mitigation (insurance, resilient siting, backup power)."
      : "High risk: consider alternative locations or invest in robust mitigation.";

  const home =
    level === "low"
      ? "Suitable for residence. Keep emergency kit and plans."
      : level === "moderate"
      ? "Assess building codes, elevation, and retrofit options."
      : "High exposure. Prefer elevated/retrofitted structures and robust insurance.";

  return { business, home, level };
}
