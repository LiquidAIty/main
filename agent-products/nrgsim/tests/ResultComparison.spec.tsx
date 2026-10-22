// @vitest-environment jsdom
// Entity: Building Results
// Relationship: Checks role labels and baseline-relative totals in the actual renderer; fixture values are display-contract tests, not simulation evidence.
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import ResultComparison, { type Comparison } from '../client/src/components/energy/ResultComparison';

afterEach(cleanup);
it('uses the selected named baseline even when it is second in the response',()=>{
  const data:Comparison={baselineCaseId:'case_reference',channel:{name:'Electricity:Facility',key:'',units:'J',frequency:'Hourly'},
    timeBasis:'interval-end/local-standard-time',rows:[],hourly:null,
    cases:[{caseId:'case_performance',name:'Candidate',runId:'performance-run',revision:'p',engine:'25.2',weatherSha256:'weather',missing:0},
      {caseId:'case_reference',name:'Reference',runId:'baseline-run',revision:'b',engine:'25.2',weatherSha256:'weather',missing:0}],
    summary:{units:'kWh',values:[80,100],changePercent:[-20,0]}};
  render(<ResultComparison data={data}/>);
  expect(screen.getByText('Performance · Candidate: 80 kWh (-20.0%)')).toBeTruthy();
  expect(screen.getByText('Baseline · Reference: 100 kWh')).toBeTruthy();
  expect(screen.queryByText(/\(0.0%\)/)).toBeNull();
});
