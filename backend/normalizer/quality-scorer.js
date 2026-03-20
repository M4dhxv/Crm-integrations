/**
 * Quality Scorer — Per-record and per-platform quality assessment
 * Scores records 0–100 based on field completeness, format validity, freshness
 */

import { isValidEmail, standardizePhone, standardizeDate } from './standardizers.js';

// Weight config for quality scoring
const FIELD_WEIGHTS = {
  crm_contacts: {
    external_id: { weight: 10, type: 'required' },
    last_name:   { weight: 15, type: 'required' },
    first_name:  { weight: 10, type: 'optional' },
    email:       { weight: 25, type: 'format',   validator: isValidEmail },
    phone:       { weight: 15, type: 'format',   validator: (v) => /^\+[1-9]\d{1,14}$/.test(v) },
    title:       { weight: 5,  type: 'optional' },
    company_name:{ weight: 10, type: 'optional' },
    department:  { weight: 5,  type: 'optional' },
    lead_source: { weight: 5,  type: 'optional' },
  },
  crm_companies: {
    external_id:    { weight: 10, type: 'required' },
    name:           { weight: 25, type: 'required' },
    domain:         { weight: 15, type: 'optional' },
    industry:       { weight: 10, type: 'optional' },
    phone:          { weight: 10, type: 'format', validator: (v) => /^\+[1-9]\d{1,14}$/.test(v) },
    website:        { weight: 10, type: 'optional' },
    employee_count: { weight: 10, type: 'optional' },
    annual_revenue: { weight: 10, type: 'optional' },
  },
  crm_deals: {
    external_id: { weight: 10, type: 'required' },
    name:        { weight: 20, type: 'required' },
    amount:      { weight: 20, type: 'optional' },
    stage:       { weight: 15, type: 'optional' },
    close_date:  { weight: 15, type: 'format',  validator: (v) => !!standardizeDate(v) },
    pipeline:    { weight: 10, type: 'optional' },
    currency:    { weight: 10, type: 'optional' },
  },
  crm_call_recordings: {
    external_call_id: { weight: 15, type: 'required' },
    title:            { weight: 15, type: 'optional' },
    call_date:        { weight: 20, type: 'format', validator: (v) => !!standardizeDate(v) },
    duration_seconds: { weight: 15, type: 'optional' },
    direction:        { weight: 10, type: 'optional' },
    participants:     { weight: 15, type: 'optional' },
    recording_url:    { weight: 10, type: 'optional' },
  }
};

/**
 * Score a single record's data quality
 * Returns { overallScore, fieldScores, issues }
 */
export function scoreRecord(record, targetTable) {
  const weights = FIELD_WEIGHTS[targetTable];
  if (!weights) {
    return { overallScore: 0, fieldScores: {}, issues: [] };
  }

  const fieldScores = {};
  const issues = [];
  let totalWeight = 0;
  let earnedWeight = 0;

  for (const [field, config] of Object.entries(weights)) {
    const value = record[field];
    totalWeight += config.weight;
    let fieldScore = 0;

    if (config.type === 'required') {
      if (value !== null && value !== undefined && value !== '') {
        fieldScore = 100;
        earnedWeight += config.weight;
      } else {
        issues.push({
          field,
          rule: 'required_check',
          severity: 'error',
          message: `Required field "${field}" is missing`
        });
      }
    } else if (config.type === 'format') {
      if (value !== null && value !== undefined && value !== '') {
        if (config.validator && config.validator(value)) {
          fieldScore = 100;
          earnedWeight += config.weight;
        } else {
          fieldScore = 30;  // has value but wrong format
          earnedWeight += config.weight * 0.3;
          issues.push({
            field,
            rule: 'format_validation',
            severity: 'warning',
            message: `Field "${field}" has invalid format: "${value}"`
          });
        }
      } else {
        issues.push({
          field,
          rule: 'completeness',
          severity: 'info',
          message: `Optional field "${field}" is empty`
        });
      }
    } else {
      // optional — present = full score, absent = 0
      if (value !== null && value !== undefined && value !== '') {
        fieldScore = 100;
        earnedWeight += config.weight;
      }
    }

    fieldScores[field] = fieldScore;
  }

  const overallScore = totalWeight > 0 ? Math.round((earnedWeight / totalWeight) * 100) : 0;

  return {
    overallScore,
    fieldScores,
    issues,
    issueCount: issues.length,
  };
}

/**
 * Score multiple records and compute aggregated platform metrics
 */
export function scorePlatform(records, targetTable) {
  if (!records || records.length === 0) {
    return {
      totalRecords: 0,
      avgScore: 0,
      highQuality: 0,
      mediumQuality: 0,
      lowQuality: 0,
      fieldCoverage: {},
      commonIssues: [],
    };
  }

  const scores = records.map(r => scoreRecord(r, targetTable));
  const totalRecords = scores.length;

  // Aggregate scores
  const avgScore = Math.round(scores.reduce((sum, s) => sum + s.overallScore, 0) / totalRecords);
  const highQuality = scores.filter(s => s.overallScore >= 80).length;
  const mediumQuality = scores.filter(s => s.overallScore >= 50 && s.overallScore < 80).length;
  const lowQuality = scores.filter(s => s.overallScore < 50).length;

  // Field coverage (% of records with non-null values)
  const fieldCoverage = {};
  const weights = FIELD_WEIGHTS[targetTable] || {};
  for (const field of Object.keys(weights)) {
    const nonNull = records.filter(r =>
      r[field] !== null && r[field] !== undefined && r[field] !== ''
    ).length;
    fieldCoverage[field] = Math.round((nonNull / totalRecords) * 100) / 100;
  }

  // Most common issues
  const issueCounter = {};
  for (const s of scores) {
    for (const issue of s.issues) {
      const key = `${issue.field}:${issue.rule}`;
      issueCounter[key] = (issueCounter[key] || 0) + 1;
    }
  }
  const commonIssues = Object.entries(issueCounter)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([key, count]) => {
      const [field, rule] = key.split(':');
      return { field, rule, count, percentage: Math.round((count / totalRecords) * 100) };
    });

  return {
    totalRecords,
    avgScore,
    highQuality,
    mediumQuality,
    lowQuality,
    fieldCoverage,
    commonIssues,
    scores,
  };
}

/**
 * Get the weight config for a table (useful for UI)
 */
export function getFieldWeights(targetTable) {
  return FIELD_WEIGHTS[targetTable] || {};
}
