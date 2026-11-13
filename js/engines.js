// Engines (Phase 18a): ready-made engines and the propellant data the engine model needs (core.js engineSpec /
// engineCurve). Text-free: names are i18n 'eng.<id>', notes 'cred.eng.<id>' (Sources window, "Hazır motorlar");
// src: ENG_SRC keys. Every value as published, converted only by the factors given (1 lbf = 4.4482216 N,
// 1 lb = 0.45359237 kg); derived values say how. No company's internal data.
//
// ENGINES: { id, type: 'liq' | 'hyb' | 'sol' | 'mono', prop: PROPS key, F (N, vacuum; mean for hybrid and solid),
// isp (s, vacuum; mean), of (oxidizer/fuel by mass; liquid and hybrid), mp, md (kg: a load to start from; from the
// vehicle named, else as noted), veh (js/vehicles.js id the masses come from), hyb / sol (the model's own inputs), ex
// (true: an example design, not a real engine) }.
//
// rl10    RL10A-4-2 (Centaur, single engine): thrust 99.2 kN and Isp 450.5 s from the ULA Atlas V Launch Services
//         User's Guide (March 2010), Figure 1.4.1-3 (as js/vehicles.js 'centaur'); mixture ratio "5.5:1" from the
//         L3Harris (Aerojet Rocketdyne) RL10 data sheet. Masses: Centaur (vehicles.js).
// aj10    Aerojet AJ10-137, the Apollo service propulsion system: thrust and Isp as js/vehicles.js 'csm' (Apollo 11
//         press kit 20,500 lbf → 91,188.5 N; NTRS 20100027319, 314.5 s). O/F derived from the Apollo Operations
//         Handbook's gaugeable loads (vehicles.js 'csm'): oxidizer 24,389.10 lb / fuel 15,252.70 lb = 1.5990.
//         Propellants N2O4 / Aerozine 50. Masses: the CSM (vehicles.js).
// s400    ArianeGroup S400-12 apogee motor: "Thrust, Nominal 420N", "Specific Impulse at Nominal Point 318 s",
//         "Mixture Ratio, Nominal 1.65", MMH with N2O4 (MON-1, MON-3). Masses: Mars Express (vehicles.js).
// n2h4    A 22 N hydrazine thruster: NASA Lunar Prospector's ("6 hydrazine monopropellant 22-Newton thrusters",
//         NSSDCA 1998-001A), Isp 230 s from ArianeGroup's 20 N hydrazine thruster page ("Specific impulse (vac) 222 to
//         230 sec", the upper value), as js/vehicles.js 'lp'. Masses: Lunar Prospector (vehicles.js).
// star48  Northrop Grumman STAR 48B, long nozzle (TE-M-711-18, flight-proven; Delta II PAM third stage): Propulsion
//         Products Catalog, motor performance (75 °F, vacuum): "Burn time average thrust, lbf 15,430" → 68,636.06 N;
//         "Effective specific impulse, lbf-sec/lbm 292.1"; weights: "Propellant (including igniter propellant) 4,431.2"
//         lbm → 2,009.96 kg, "Burnout 257.8" lbm → 116.94 kg (the motor alone: the payload adds to the dry mass);
//         also "Burn time/action time, sec 84.1/85.2", "Total impulse, lbf-sec 1,303,700", "Maximum thrust, lbf
//         17,490", propellant TP-H-3340. Grain: BATES-like near-neutral profile (the catalog's curve is not modelled).
// hyb     An example N2O/HTPB hybrid, not a real engine (ex): thrust, Isp, O/F, masses and port radius are example
//         design values to start from. Only the regression law is sourced (PROPS n2o_htpb).
const ENGINES = [
  { id: 'rl10', type: 'liq', prop: 'lox_lh2', F: 99200, isp: 450.5, of: 5.5, veh: 'centaur', src: ['avug', 'rl10ds'] },
  { id: 'aj10', type: 'liq', prop: 'nto_a50', F: 91188.5, isp: 314.5, of: 24389.10 / 15252.70, veh: 'csm', src: ['a11pk', 'aj10', 'aoh'] },
  { id: 's400', type: 'liq', prop: 'nto_mmh', F: 420, isp: 318, of: 1.65, veh: 'mex', src: ['s400'] },
  { id: 'n2h4', type: 'mono', prop: 'n2h4', F: 22, isp: 230, veh: 'lp', src: ['lpNssdca', 'cht20'] },
  { id: 'star48', type: 'sol', prop: 'apcp', F: 15430 * 4.4482216, isp: 292.1, mp: 4431.2 * 0.45359237, md: 257.8 * 0.45359237, sol: { grain: 'bates' }, src: ['ngcat'] },
  { id: 'hyb', type: 'hyb', prop: 'n2o_htpb', F: 5000, isp: 250, of: 6.5, mp: 300, md: 150, hyb: { r0: 0.03 }, ex: true, src: ['doran'] },
];
// Propellants: plume class for Phase 18c (blue: hydrogen, orange: kerosene, white: solid, faint: monopropellant, amber:
// storable and hybrid); for hybrids the regression law ṙ = a·G_ox^n (ṙ mm/s, G_ox kg/(m²·s)), the fuel's density rho
// (kg/m³; only for the grain's length on screen, the performance needs ρ·L alone; 0: none published here) and the
// vacuum Isp against O/F (ispOF: [[O/F, Isp s], …]; null: not yet, Isp kept constant, noted in the Model window).
//
// lox_paraffin  Regression: Karabeyoglu, Cantwell and Zilliac, "Development of Scalable Space–Time Averaged Regression
//               Rate Expressions for Hybrid Rockets", J. Propulsion and Power 23(4), 2007, Table 1 (paraffin, NASA
//               Ames motor tests, measured with gaseous oxygen): flux exponent n = 0.62; test 4P-01 (length exponent
//               0.000) regression rate coefficient a = 9.36 × 10⁻² (mm/s, m, kg/(m²·s), the table's note); the same
//               paper's simulated case takes the fuel density as 920 kg/m³.
//               Isp: NASA CEA (CEA2, February 5, 2004; McBride and Gordon, RP-1311), run with CEARUN on 2026-11-13:
//               rocket problem, infinite area combustor, equilibrium (shifting) composition during expansion, chamber
//               pressure 30 bar, supersonic area ratio Ae/At = 50, fuel 'paraffin' (CEA library, 298.15 K, enthalpy
//               −1,860,600 kJ/kg-mol), oxidant O2(L) (90.17 K, −12,979 kJ/kg-mol). Ivac at the exit, m/s: O/F 1.00
//               2633.8, 1.25 2773.0, 1.50 2981.1, 1.75 3179.2, 2.00 3328.4, 2.25 3424.3, 2.50 3474.9, 2.75 3483.7,
//               3.00 3457.6, 3.25 3417.6, 3.50 3374.9, 3.75 3332.5, 4.00 3290.8 (here ÷ g₀ = 9.80665 for seconds).
// n2o_htpb      Regression: Doran, Dyer, Lohner, Dunn, Cantwell and Zilliac, "Nitrous Oxide Hybrid Rocket Motor Fuel
//               Regression Rate Characterization", AIAA 2007-5352: a = 0.1876, n = 0.347 (as tabulated in Wikipedia's
//               "Hybrid rocket fuel regression", space-time averaged coefficients; the units of that paper's fits, mm/s
//               and kg/(m²·s), as stated for its N2O/HDPE fit by Ito, Kamps and Nagata, "Fuel Regression
//               Characteristics in Hybrid Rockets Using N2O/HDPE", AIAA 2019-4120, J. Propulsion and Power). CEA has no
//               HTPB in its library and CEARUN takes no user-defined reactant: Isp constant until a CEA table is given.
const CEA_PARAFFIN_IVAC = [[1.00, 2633.8], [1.25, 2773.0], [1.50, 2981.1], [1.75, 3179.2], [2.00, 3328.4], [2.25, 3424.3], [2.50, 3474.9], [2.75, 3483.7], [3.00, 3457.6], [3.25, 3417.6], [3.50, 3374.9], [3.75, 3332.5], [4.00, 3290.8]];
const PROPS = {
  lox_lh2: { plume: 'blue' },
  lox_rp1: { plume: 'orange' },
  nto_a50: { plume: 'amber' },
  nto_mmh: { plume: 'amber' },
  n2h4: { plume: 'faint' },
  h2o2: { plume: 'faint' },
  apcp: { plume: 'white' },
  n2o_htpb: { plume: 'amber', hyb: { a: 0.1876, n: 0.347, rho: 0, ispOF: null }, src: ['doran', 'kamps', 'wikiReg'] },
  lox_paraffin: { plume: 'amber', hyb: { a: 9.36e-2, n: 0.62, rho: 920, ispOF: CEA_PARAFFIN_IVAC.map(([of, c]) => [of, c / 9.80665]) }, src: ['kcz2007', 'cearun'] },
};
const ENG_SRC = {
  avug: 'https://www.ulalaunch.com/docs/default-source/rockets/atlasvusersguide2010.pdf',
  rl10ds: 'https://www.l3harris.com/all-capabilities/rl10-engine',
  a11pk: 'https://www.nasa.gov/wp-content/uploads/static/apollo50th/pdf/A11_PressKit.pdf',
  aj10: 'https://ntrs.nasa.gov/citations/20100027319',
  aoh: 'https://www.ibiblio.org/apollo/ApolloProjectOnline/Documents/SMA2A-03-BLOCK%20II%20Volume%201%2019691015/aoh-v1-2-04-sps.pdf',
  s400: 'https://www.space-propulsion.com/spacecraft-propulsion/apogee-motors/index.html',
  lpNssdca: 'https://nssdc.gsfc.nasa.gov/nmc/spacecraft/display.action?id=1998-001A',
  cht20: 'https://www.space-propulsion.com/spacecraft-propulsion/hydrazine-thrusters/20n-hydrazine-thruster.html',
  ngcat: 'https://cdn.northropgrumman.com/-/media/wp-content/uploads/NG-Propulsion-Products-Catalog.pdf',
  doran: 'https://doi.org/10.2514/6.2007-5352',
  kamps: 'https://eprints.lib.hokudai.ac.jp/dspace/bitstream/2115/81670/1/JPP_for_submittion.pdf',
  wikiReg: 'https://en.wikipedia.org/wiki/Hybrid_rocket_fuel_regression',
  kcz2007: 'https://web.stanford.edu/~cantwell/AA284A_Course_Material/AA284A_Resources/Karabeyoglu,%20Cantwell%20and%20Zilliac,%20Development%20of%20Scalable%20Space%e2%80%93Time%20Averaged%20Regression%20Rate%20Expressions%20for%20Hybrid%20Rockets%20JPP%20Vol%2023%202007.pdf',
  cearun: 'https://cearun.grc.nasa.gov/',
};

if (typeof module !== 'undefined') module.exports = { ENGINES, PROPS, ENG_SRC, CEA_PARAFFIN_IVAC };
