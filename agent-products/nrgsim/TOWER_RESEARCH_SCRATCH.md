<!-- Entity: Building Study -->
<!-- Relationship: Retains research provenance, evolving architectural alternatives and unresolved modeling questions for the open microcity challenge. -->
# Microcity research scratchpad

## Research window

Owner requested one hour of online research with agents. Started2026-10-22T01:44:08Z (October21,9:44pm America/New_York); target completion02:44:08Z (10:44pm). Two read-only research scouts cover technology/modeling and worldwide built/design precedents; Primary owns this record and synthesis. The other platform chat may continue. No runtime/code/model changes during this research.

## Owner steering to retain

- Build the playing field, not a preselected winning building. This is a test of actual energy-modeling ability.
- Worldwide, ambitious design; include major occupancy families and the owner's legacy occupancy data.
- Solar-maximized south-facing surfaces; PV above evapotranspiring planting; PCM; data center; vertical farm; greenhouse; event-center ambition beyond Sphere; virtual high-floor video windows; skyport.
- Candidate form sequence: kilometre-high tower → sphere/twelve-sided crown → inhabited wall/microcity → pyramid → three-building circular tripod converging to shared skyplace. These are design alternatives, not implemented models; latest tripod is the leading candidate, not final engineering approval.
- Site: Vegas confirmed, LA also proposed. Future feature: move the design among world sites and recompute the corresponding climate cases.
- Owner added underground train station if reasonable. Preserve this as a transit-interface design objective; do not assume any LasVegas parcel has a subway or that a road-vehicle tunnel is a rail station.
- Later site decision supersedes Vegas-as-primary: LA because the owner knows architecture firms there. Specific concept now encompasses the wholeSkidRow area under hypothetical purchase/clear/redevelop assumptions. This is not external-action authority. Owner wants low-cost and expensive apartments, SROs and larger residences; existing community and replacement/service obligations are real context, not an empty-land fiction.
- Later massing clarification: many buildings and streets/tunnel streets are acceptable; vibrant FashionDistrict street-level retail, offices, galleries, shops, grocery, event center, labs, bunkers and skyports matter. The organizing concept is now a **microgrid city**, with a landmark/skyplace option rather than a compulsory single megastructure.
- Intended product role: default SimCity-like challenge scene plus an option to make one's own building. This is a future real authoring/simulation workflow, not a fake city-game dataset or approval to overwrite today's accepted model.
- Latest explicit target: controversial hypothetical redevelopment site for the tallest, widest, deepest and most useful interconnected building/city. Treat clearance/land assembly as an explicit scenario assumption; do not claim current vacancy, ownership or approvals. Record targets separately from verified world records, and define useful services rather than treating floor area alone as usefulness.
- Final clarification of “SimCity”: not a separate game to clone. The product is an open default-building challenge—owner presents an ambitious biggest/most-efficient design and invites users to make it better. Clone/change/run/compare/share is the core loop. Preserve boldness while keeping records, efficiency metrics and actual simulation status truthful.
- Subsequent clarification supersedes challenge forks: one shared evolving city; AI judges scoped proposals using E+ evidence; a better accepted proposal wins virtual territory/credit and becomes the current design. Internal candidate snapshots are verification artifacts, not separate user-facing city versions. Separately, users may remove an example from their own workspace and make a personal project. No deletion was performed. Actual LA property ownership is not implied by the game mechanic.
- Owner wants a deliberately incomplete starter that invites collaborators across disciplines, plus a possible electric-shuttle tunnel connection to a real subway station even if the connecting distance is substantial. Record the assumed length/service/energy separately; a road-vehicle tunnel is not subway infrastructure or verified capacity.
- Owner reports prior conservatory, Rocky Mountain Institute,100+ JohnsonControls battery/other factories and several skyscraper projects. Treat this as owner-provided context, not independently verified public project credits; confirm precise names/roles before publishing biography.
- Earlier accepted single-zone result and app remain separate from the future microcity challenge.

## Legacy occupancy evidence

Read-only ZIP inventory of C:/Users/jerem/Downloads/jEPlus-master.zip found jEPlus-master/Facade/include/:

Auditorium, Classroom, Clinic, Commercial, ConventionCenter, Financial, Grocery, Industrial, Library, Office, Residential, Restaurant, Worship, and UnknownOccupancy IDF files.

That is13 named categories plus Unknown, not proof of every contemporary use or a complete current-IDD migration. Contents, schedules, units, per-area/per-person bases and scope still need inspection. The two NRGSIM ZIPs also contain public/app/templates/sim.us. No archive was extracted/modified in this pass. Data-center, crop, greenhouse, event AV and aircraft-charging specifics need their own load/service definitions if absent.

Primary inspected Office, Industrial and Residential include bodies. They contain actual People, Lights, ElectricEquipment and HotWaterEquipment objects, not just names. Examples: Office9.29m²/person,9.15W/m² lights,14.43W/m² equipment; Industrial13.27m²/person and10.77W/m² lights/equipment; Residential43.5673m²/person,19.3750W/m² lights and14.9618W/m² equipment. These are historical input values, not verified current-practice defaults. Office/Industrial reference generic BldgAvg schedules; Residential uses separate occupancy/activity/lights/equipment schedules. Comfort references include AngleFactor/ComfortView, Fanger and adaptive models; availability/applicability must be checked during migration. HotWaterEquipment denotes zone internal gains, not a complete domestic-hot-water plant. Both NRGSIM archives' sim.us templates expose the occupancy selection; actual restored UI/data migration remains a separate task.

## Primary sources and initial findings

### PCM and independent engines

- [Armstrong product introduction](https://www.armstrong.com/en-us/press-releases/armstrong-ultima-templok.html): Armstrong states the Templok business and certain technology/manufacturing assets came from Insolcorp. Do not count these as independent equivalent products without checking formulations/assemblies.
- [Armstrong Templok technical guide](https://www.armstrongceilings.com/content/dam/armstrongceilings/commercial/north-america/technical-guides/templok-technical-guide.pdf): modeling data and installed coverage matter. It distinguishes PCM-area properties from the whole ceiling, partial-cycle behavior and laboratory results. Marketing savings are not our tower result.
- [IESVE2026 Apache PCM documentation](https://help.iesve.com/ve2026/4__apache_simulation.htm): Armstrong-specific single temperature-dependent Cp curve, variable conductivity, PCM state and reduced conduction timestep. This is not by itself full hysteresis validation or an arbitrary material library.
- [CEC-500-2024-086](https://www.energy.ca.gov/publications/2024/phase-change-material-enhanced-insulation-residential-exterior-wall-retrofits): laboratory/model/field work for a combined insulation/PCM retrofit; do not attribute package savings solely to PCM or extrapolate homes to a megatall.
- [EnergyPlus issue10420](https://github.com/NatLabRockies/EnergyPlus/issues/10420): scout flags unresolved hysteresis behavior; independently review the exact issue, tested engine version and benchmark before making PCM rankings. An available object is not validated physics.
- [Rubitherm current RT catalog](https://www.rubitherm.com/produktkategorie/organische-pcm-rt): RT24HC is a candidate organic reference. Main's old direct PDF URL returned404; follow the current manufacturer's catalog link before adopting full properties. A catalog capacity is not a complete assembly/enthalpy model.

### Solar planting and thermal systems

- [PVWatts model documentation](https://developer.nlr.gov/docs/solar/pvwatts/v8/): a candidate PV calculation/reference, not an installed NRGsim integration or a verified module-selection winner.
- [2026 Hong Kong biosolar field study](https://www.sciencedirect.com/science/article/pii/S0960148126006312) and [2026 multi-year study](https://www.sciencedirect.com/science/article/pii/S0378778826005724): scout reports modest/configuration-dependent gains and maintenance/shading penalties. Verify denominators, periods and full method before quoting numerical benefits.
- [Hot-dry green-roof experiment](https://www.sciencedirect.com/science/article/pii/S0378778813005872): irrigation/consumptive-water costs can dominate the evaporative strategy; do not treat cooling from water loss as free.
- [Stanford radiative cooling system](https://engineering.stanford.edu/news/how-new-cooling-system-works-without-using-any-electricity): field demonstration is a technology reference, not whole-megatall proof. PV, planting and radiators compete for terrace/sky-view area.
- [DOE Ford central energy plant](https://betterbuildingssolutioncenter.energy.gov/showcase-projects/ford-motor-company-dearborn-research-and-engineering-campus-central-energy-plant): real heat-recovery/storage backbone precedent; verify boundary and auxiliary energy.
- [IEA district heat pumps](https://www.iea.org/articles/heat-pumps-in-district-heating-and-cooling-systems): recovered heat usefulness depends on temperature, demand and system connection.

### Worldwide design references

- [Azabudai Hills owner](https://www.mori.co.jp/en/press/release/mori_building_celebrates_the_o/): built mixed-use district with housing, office, hotel, retail, culture, medical and school functions. Renewable electricity procurement is not onsite roof self-sufficiency.
- [Shanghai Tower engineer](https://www.thorntontomasetti.com/project/shanghai-tower): built632m mixed-use/form/wind precedent, not evidence that our1000m structure or annual energy is solved.
- [CapitaSpring owner](https://www.capitaland.com/en/about-capitaland/newsroom/news-releases/international/2022/feb/CapitaSpring-biophilic-skyscraper-completion.html): built mixed-use/sky-garden/urban-farm precedent; operational yield and net-energy data need separate proof.
- [Roche Basel Tower2](https://www.roche.ch/en/media-switzerland/informationen/med-ch-2022-09-02): heating/cooling resource connections illustrate district integration; do not assume resources exist at the selected US site.
- [De Rotterdam](https://www.oma.com/projects/de-rotterdam), [Linked Hybrid](https://www.stevenholl.com/project/beijing-linked-hybrid/), [Habitat67](https://www.safdiearchitects.com/projects/habitat-67), [The Interlace](https://www.oma.com/projects/the-interlace): program/terrace/connected-public-space references, not generic energy-saving claims.
- [Agrotopia research pilot](https://inagro.be/sites/default/files/media/files/2023-07/D2.2.5_TEFS_ENG.pdf) and [Hengshui vertical farm](https://www.vanbergenkolpa.nl/en-gb/project/vertical-farm-hengshui): distinguish LED crop production, daylit greenhouse and human climate zones; do not infer a vertical farm is automatically a heat sink.
- [Royal Caribbean virtual balconies](https://www.royalcaribbean.com/aus/en/faq/questions/what-is-a-virtual-balcony): operational virtual-view precedent; screens do not replace real daylight, ventilation or life-safety openings.
- [Sphere2023 SEC filing](https://www.sec.gov/Archives/edgar/data/1795250/000179525023000017/sphr-20230630.htm) and [HOLOPLOT case study](https://www.holoplot.com/case-studies/msg-sphere-case-study): verify capacity, media and audio claims separately. Public metered energy/water baseline not yet established. Do not turn a peak MW claim into annual consumption.

### Constraints that should shape the field

- [ASHRAE90.1](https://www.ashrae.org/technical-resources/bookstore/standard-90-1) supplies minimum-efficiency/compliance rules, not a maximum-performance ceiling. Edition/method and local-code applicability are unresolved before public compliance claims.
- [ASHRAE tall buildings](https://handbook.ashrae.org/Handbooks/A23/IP/A23_Ch04/A23_Ch04_ip.aspx): wind/stack/pressure zones and hydronic isolation are relevant. Closed-loop static pressure is not repeatedly pumping all water up the entire height.
- [LVVWD conservation measures](https://www.lvvwd.com/conservation/measures/index.html): scout flags newcommercial/industrial evaporative-cooling restrictions in this service area. Confirm exact parcel/provider and distinguish plant ET/irrigation from regulated cooling equipment; do not assume this bans all greenery or permits cooling towers.
- [SNWA irrigation](https://www.snwa.com/conservation/change-your-irrigation-clock/index.html): outdoor ET is consumptive; count water source and return-flow consequences.
- Skyport: official FAA/aviation guidance, actual aircraft/charging/noise/downwash/approach requirements still to be researched. No flight approval implied.

### Further verified design and site findings

- [LA City Planning adopted Downtown Community Plan](https://planning.lacity.gov/plans-policies/community-plan-area/downtown-community-plan) became effective in February 2025. The City's earlier staff report describes Skid Row generally between 3rd/7th and Main/Alameda; [Fashion District BID](https://fashiondistrict.org/about) is a different, larger service-area polygon. Do not substitute either outline for verified parcels or an entitlement boundary.
- [LA County Skid Row Action Plan](https://homeless.lacounty.gov/skid-row-action-plan/) documents current housing, care, services and community planning. It is context for the separate real-world impact scenario, not a claim that our hypothetical redevelopment is an adopted plan.

- [Marina Bay Sands Arup](https://www.arup.com/projects/marina-bay-sands-integrated-resort/): built three-tower shared SkyPark at approximately200m,340m long; independent tower movement is explicitly engineered. This supports the organizing idea, not extrapolation to1000m.
- [Raffles City Chongqing owner](https://www.capitaland.com/en/about-capitaland/newsroom/news-releases/international/2020/jun/CapitaLand-opens-250-metre-high-glass-bottom-Exploration-Deck-at-RCCQ.html): inhabited garden/recreation bridge at250m; a program reference for a genuine shared skyplace.
- [MBS2024 operating report](https://www.marinabaysands.com/content/dam/marinabaysands/sustainability/reports/mbs-responsible-business-highlights-report-2024.pdf): scout distinguishes actual property energy, small onsite PV contribution and purchased certificates. Never equate an impressive planted/solar crown with energy autonomy.
- [FAA current AAM infrastructure guidance](https://www.faa.gov/airports/new_entrants/aam_infrastructure) and [EB105A](https://www.faa.gov/airports/engineering/engineering_briefs/eb_105a_vertiports), dated27December2024: current guidance has a specific aircraft/operational envelope and downwash/outwash provisions. It does not establish that a1km-high skyport is feasible. Owner clarified space for vertical OR short takeoff; retain distinct VTOL and STOL envelopes, not one generic pad.
- [California2025 Energy Code](https://www.energy.ca.gov/programs-and-topics/programs/building-energy-efficiency-standards/2025-building-energy-efficiency) applies to permit applications from1January2026. A90.1 research reference is not an LA permit-compliance claim.
- Primary read [EnergyPlus issue10420](https://github.com/NatLabRockies/EnergyPlus/issues/10420): it remains open. This establishes a reported unresolved validation risk, not proof that every case/version is wrong. Reproduce relevant partial-cycle behavior before awarding PCM performance credit.

### Source corrections to earlier research hypotheses

- Scout inspected [EnergyPlus25.2 EcoRoofManager.cc](https://raw.githubusercontent.com/NatLabRockies/EnergyPlus/v25.2.0/src/EnergyPlus/EcoRoofManager.cc): EcoRoof requires CTF, not CondFD, and its shared construction/first-surface assumptions matter for differently exposed planted terraces. Keep PCM on separate surfaces and verify whether a multi-height landscape approximation is acceptable before claiming each roof is separately resolved.
- Scout inspected [EnergyPlus25.2 PCMThermalStorage.cc](https://raw.githubusercontent.com/NatLabRockies/EnergyPlus/v25.2.0/src/EnergyPlus/PCMThermalStorage.cc): the tank shares a PCM material/enthalpy primitive but does not execute the full freezing/reversal specific-heat path implicated in issue10420. The earlier suggestion that it mechanically inherits that exact defect is withdrawn. It has separate scalar-energy/SOC behavior and a one-tank limitation; it needs its own charge/discharge energy-balance validation. SDK/MCP exposure is a separate question.
- CEC report explicitly cites Lee and Crossett2017 and tested the official hysteresis object in EnergyPlus9.5. Its alternative Feng model was compiled for8.9. Keep those exact versions separate from an unperformed25.2 reproduction.

## Open questions and model boundaries

1. Which footprint/site/program constitutes version0, and which geometry changes belong in the separate morphology round?
2. Which old occupancy definitions actually contain loads/schedules versus labels/macros? How do they map to current OSM space types without losing units or diversity?
3. Can nativePCM behavior reproduce an agreed measured partial-cycle/hysteresis benchmark? Keep solver-validation work separate from product rankings.
4. Which energy/water couplings are supported directly, which require a validated approximation, and which remain externally calculated? Do not substitute fake zeroes.
5. How much photovoltaic/green/radiator/skyport/public terrace area is actually available after shading, access and structural constraints?
6. What service-equivalent reference can compare event experience, food production, computing and ordinary occupancies fairly?
7. How are design-climate cases relocated while preserving geometry, north/orientation choices, program and exact run identity?

This scratchpad is intentionally provisional and will be corrected as primary sources are reviewed. Research statements above are not product controls, simulation outputs or endorsement claims.
