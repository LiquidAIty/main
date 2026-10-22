// @vitest-environment jsdom
// Entity: Building Modeling
// Relationship: Tests draft-preservation and revision conflicts at the inspector; mocked transport is not live-agent or simulation proof.
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import NrgsimWorkspace from '../client/src/components/energy/NrgsimWorkspace';

vi.mock('../client/src/components/energy/EnergyFacadeSurface', () => ({ OpenStudioBlockScene: () => <div>Viewport test double</div> }));
vi.mock('../client/src/components/energy/ResultComparison', () => ({ default: () => <div role="region" aria-label="Comparison renderer test double"/>, caseName: (id: string) => ({baseline:'Baseline',case1:'Comparison 1',case2:'Comparison 2'}[id] || id) }));

const makeCase = (id: string, revision='r1', value=3) => ({
  id,name:id,revision,geometry:{modelId:'building',revision,units:'m',objects:[],spaces:[],bounds:null},
  walls:[],resultsCurrent:false,requestedOutputs:[],availableOutputs:[],history:[],weather:null,run:null,
  controls:[{id:'height',objectHandle:'space',field:'height',label:'Height',tab:'geometry',group:'Floor',scopes:['building'],
    value,units:'m',min:.5,max:50,step:.1,integer:false,kind:'number',choices:null}],
});
const state = (revision='r1', value=3) => ({configured:true,cases:[makeCase('baseline'),makeCase('case1',revision,value)]});
const response = (data: unknown, ok=true) => ({ok,json:async()=>data}) as Response;
afterEach(() => {cleanup();vi.unstubAllGlobals();vi.restoreAllMocks();document.body.innerHTML='';});

async function mount() {
  vi.spyOn(document,'visibilityState','get').mockReturnValue('visible');
  const inspector=document.createElement('div');document.body.appendChild(inspector);
  const view=render(<NrgsimWorkspace projectId="test-project" inspectorContainer={inspector}/>);
  await waitFor(()=>expect((screen.getByRole('button',{name:'Performance',exact:true}) as HTMLButtonElement).disabled).toBe(false));
  await act(async()=>fireEvent.click(screen.getByRole('button',{name:'Performance',exact:true})));
  await waitFor(()=>expect((screen.getByLabelText('Height',{exact:true}) as HTMLInputElement).disabled).toBe(false));
  return {...view,inspector};
}

describe('NRGSIM draft ownership',()=>{
  it('keeps a historical performance snapshot and its channels when switching cases',async()=>{
    const latest={id:'latest',name:'Latest channel',key:'Zone',units:'C',frequency:'Hourly'};
    const historical={id:'old',name:'Historical channel',key:'Zone',units:'C',frequency:'Hourly'};
    const completed={configured:true,cases:[makeCase('baseline'),makeCase('case1')].map(item=>({...item,
      run:{status:'success',runId:`run-${item.id}`,revision:item.revision,channels:[latest,historical],nativeEnd:''},
      history:[{runId:`run-${item.id}`,revision:item.revision},{runId:`old-${item.id}`,revision:'r0'}]}))};
    completed.cases[1].run.channels=[latest];
    const fetcher=vi.fn().mockImplementation((_url,init)=>{
      const payload=JSON.parse(init.body),item=completed.cases.find(value=>value.id===payload.caseId);
      if(payload.operation==='inspect_run') return Promise.resolve(response({...item,revision:payload.runId.startsWith('old')?'r0':'r1',
        run:{...item!.run,runId:payload.runId,channels:payload.runId.startsWith('old')?[historical]:item!.run.channels}}));
      return Promise.resolve(response(completed));
    });
    vi.stubGlobal('fetch',fetcher);await mount();
    await act(async()=>fireEvent.change(screen.getByLabelText('Model revision'),{target:{value:'old-case1'}}));
    await act(async()=>fireEvent.click(screen.getByRole('button',{name:'Baseline',exact:true})));
    await act(async()=>fireEvent.click(screen.getByRole('button',{name:'Performance',exact:true})));
    expect((screen.getByLabelText('Model revision') as HTMLSelectElement).value).toBe('old-case1');
    fireEvent.click(screen.getByRole('tab',{name:'Results'}));
    expect((screen.getByLabelText('Output channel') as HTMLSelectElement).value).toBe('old');
    expect(screen.queryByRole('option',{name:/Latest channel/})).toBeNull();
  });
  it('selects a frozen named baseline and edits outputs only on the active performance file',async()=>{
    const channel={id:'channel',name:'Cooling energy',key:'Building total',units:'J',frequency:'Hourly'};
    const completed={configured:true,cases:[makeCase('baseline'),makeCase('case1'),makeCase('case_123456789abc')].map(item=>({...item,
      controls:[...item.controls,{...item.controls[0],id:'steps',tab:'simulation',label:'Timesteps'}],
      availableOutputs:[{name:'Zone Mean Air Temperature',units:'C',sourceRunId:'run-source'}],
      run:{status:'success',runId:`run-${item.id}`,revision:item.revision,channels:[channel],nativeEnd:''},history:[]}))};
    const fetcher=vi.fn().mockImplementation((_url,init)=>{
      const payload=JSON.parse(init.body);
      if(payload.operation==='inspect_run') return Promise.resolve(response(completed.cases.find(item=>item.id===payload.caseId)));
      if(payload.operation==='compare') return Promise.resolve(response({channel,cases:[],rows:[],hourly:null,energy:null}));
      return Promise.resolve(response(completed));
    });
    vi.stubGlobal('fetch',fetcher);await mount();
    fireEvent.click(screen.getByRole('tab',{name:'Results'}));
    await act(async()=>fireEvent.change(screen.getByLabelText('Comparison baseline case'),{target:{value:'case_123456789abc'}}));
    await act(async()=>fireEvent.click(screen.getByRole('button',{name:'Compare',exact:true})));
    const request=fetcher.mock.calls.map(call=>JSON.parse(call[1].body)).find(item=>item.operation==='compare');
    expect(request).toMatchObject({cases:['case_123456789abc','case1'],baselineCaseId:'case_123456789abc',runIds:{case_123456789abc:'run-case_123456789abc'}});
    fireEvent.click(screen.getByRole('tab',{name:'Simulation'}));
    fireEvent.change(screen.getByLabelText('Requested output'),{target:{value:'Zone Mean Air Temperature'}});
    await act(async()=>fireEvent.click(screen.getByRole('button',{name:'Add to this case'})));
    const writes=fetcher.mock.calls.map(call=>JSON.parse(call[1].body)).filter(item=>['outputs','study_outputs'].includes(item.operation));
    expect(writes).toEqual([{operation:'outputs',caseId:'case1',revision:'r1',outputs:[{name:'Zone Mean Air Temperature',key:'*',frequency:'Hourly'}]}]);
  });
  it('refreshes after an observed completion but preserves a pending conflicting draft',async()=>{
    const fetcher=vi.fn().mockResolvedValue(response(state()));vi.stubGlobal('fetch',fetcher);
    const {rerender,inspector}=await mount();
    fetcher.mockResolvedValue(response(state('r2',4)));
    rerender(<NrgsimWorkspace projectId="test-project" inspectorContainer={inspector} completedRunId="completed-run-1"/>);
    await waitFor(()=>expect((screen.getByLabelText('Height',{exact:true}) as HTMLInputElement).value).toBe('4'));
    fireEvent.change(screen.getByLabelText('Height',{exact:true}),{target:{value:'3.4'}});
    fetcher.mockResolvedValue(response(state('r3',5)));
    rerender(<NrgsimWorkspace projectId="test-project" inspectorContainer={inspector} completedRunId="completed-run-2"/>);
    await screen.findByRole('alert');
    expect((screen.getByLabelText('Height',{exact:true}) as HTMLInputElement).value).toBe('3.4');
    fireEvent.click(screen.getByRole('button',{name:'Save changes'}));
    await waitFor(()=>expect(fetcher.mock.calls.map(call=>JSON.parse(call[1].body)).some(item=>item.operation==='edit_inputs' && item.revision==='r2')).toBe(true));
  });
  it('compares baseline with one selected performance case while retaining other cases',async()=>{
    const channel={id:'channel',name:'Cooling energy',key:'Building total',units:'J',frequency:'Hourly'};
    const completed={configured:true,cases:[makeCase('baseline'),makeCase('case1'),makeCase('case2')].map(item=>({...item,
      run:{status:'success',runId:`run-${item.id}`,revision:item.revision,channels:[channel],nativeEnd:''},history:[]}))};
    const fetcher=vi.fn().mockImplementation((_url,init)=>Promise.resolve(response(JSON.parse(init.body).operation==='compare'
      ? {channel,cases:[],rows:[],hourly:null,energy:null} : completed)));
    vi.stubGlobal('fetch',fetcher); await mount();
    expect(screen.queryByRole('button',{name:'Comparison 2'})).toBeNull();
    expect(screen.getByRole('option',{name:'Comparison 2'})).toBeTruthy();
    await act(async()=>fireEvent.change(screen.getByLabelText('Performance case'),{target:{value:'case2'}}));
    fireEvent.click(screen.getByRole('tab',{name:'Results'}));
    await act(async()=>fireEvent.click(screen.getByRole('button',{name:'Compare',exact:true})));
    const request=fetcher.mock.calls.map(call=>JSON.parse(call[1].body)).find(item=>item.operation==='compare');
    expect(request.cases).toEqual(['baseline','case2']);
  });
  it('removes a prior comparison when returning from a frozen run to current inputs',async()=>{
    const channel={id:'channel',name:'Zone Ideal Loads Supply Air Total Cooling Energy',key:'Building total',units:'J',frequency:'Hourly'};
    const completed={...state(),cases:state().cases.map(item=>({...item,run:{status:'success',runId:`run-${item.id}`,revision:item.revision,channels:[channel],nativeEnd:''},history:[{runId:`run-${item.id}`,revision:item.revision}]}))};
    const comparison={channel,cases:completed.cases.map(item=>({caseId:item.id,runId:item.run.runId,revision:item.revision})),rows:[],hourly:null,energy:null};
    vi.stubGlobal('fetch',vi.fn().mockImplementation((_url,init)=>Promise.resolve(response(JSON.parse(init.body).operation==='compare'?comparison:completed))));
    await mount();
    fireEvent.click(screen.getByRole('tab',{name:'Results'}));
    expect((screen.getByLabelText('Results placement') as HTMLSelectElement).disabled).toBe(true);
    await act(async()=>fireEvent.click(screen.getByRole('button',{name:'Compare',exact:true})));
    await screen.findByRole('region',{name:'Comparison renderer test double'});
    expect(screen.queryByRole('option',{name:'Daily profile'})).toBeNull();
    await act(async()=>fireEvent.click(screen.getByRole('button',{name:'Edit current model'})));
    expect(screen.queryByRole('region',{name:'Comparison renderer test double'})).toBeNull();
    expect((screen.getByLabelText('Results placement') as HTMLSelectElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('tab',{name:'Geometry'}));
    expect((screen.getByLabelText('Height',{exact:true}) as HTMLInputElement).disabled).toBe(false);
  });
  it('does not treat cached creation metadata as a new case-selection command',async()=>{
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(response({...state(),createdCaseId:'case_old_creation'})));
    await mount();
    expect((screen.getByLabelText('Height',{exact:true}) as HTMLInputElement).disabled).toBe(false);
  });
  it('does not apply a clean-started refresh after a human begins editing',async()=>{
    let resolveRefresh!: (value: Response)=>void;
    const fetcher=vi.fn().mockResolvedValue(response(state()));vi.stubGlobal('fetch',fetcher);
    await mount();
    fetcher.mockImplementationOnce(()=>new Promise<Response>(resolve=>{resolveRefresh=resolve;}));
    fireEvent(window,new Event('focus'));
    await waitFor(()=>expect(typeof resolveRefresh).toBe('function'));
    fireEvent.change(screen.getByLabelText('Height',{exact:true}),{target:{value:'3.4'}});
    await act(async()=>resolveRefresh(response(state('r2',4))));
    expect((screen.getByLabelText('Height',{exact:true}) as HTMLInputElement).value).toBe('3.4');
    expect((screen.getByRole('button',{name:'Save changes'}) as HTMLButtonElement).disabled).toBe(false);
  });
  it('retains a rejected stale draft and explicitly rereads on discard',async()=>{
    const fetcher=vi.fn().mockResolvedValue(response(state()));vi.stubGlobal('fetch',fetcher);
    await mount();
    fireEvent.change(screen.getByLabelText('Height',{exact:true}),{target:{value:'3.4'}});
    fetcher.mockResolvedValueOnce(response({error:'Model revision changed; reload before editing or running'},false));
    fireEvent.click(screen.getByRole('button',{name:'Save changes'}));
    await screen.findByRole('alert');
    expect((screen.getByLabelText('Height',{exact:true}) as HTMLInputElement).value).toBe('3.4');
    expect(JSON.parse(fetcher.mock.calls.at(-1)![1].body)).toMatchObject({operation:'edit_inputs',revision:'r1'});
    fetcher.mockResolvedValueOnce(response(state('r2',4)));
    fireEvent.click(screen.getByRole('button',{name:'Discard and reload'}));
    await waitFor(()=>expect((screen.getByLabelText('Height',{exact:true}) as HTMLInputElement).value).toBe('4'));
  });
});
