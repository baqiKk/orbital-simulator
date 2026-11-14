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
//               3.00 3457.6, 3.25 3417.6, 3.50 3374.9, 3.75 3332.5, 4.00 3290.8 (here ÷ g₀ = 9.80665 for seconds); extended
//               to O/F 6 and ε = 300 on 2026-11-14 (CEA below, the hybrid's Isp table its ε = 50 column).
// n2o_htpb      Regression: Doran, Dyer, Lohner, Dunn, Cantwell and Zilliac, "Nitrous Oxide Hybrid Rocket Motor Fuel
//               Regression Rate Characterization", AIAA 2007-5352: a = 0.1876, n = 0.347 (as tabulated in Wikipedia's
//               "Hybrid rocket fuel regression", space-time averaged coefficients; the units of that paper's fits, mm/s
//               and kg/(m²·s), as stated for its N2O/HDPE fit by Ito, Kamps and Nagata, "Fuel Regression
//               Characteristics in Hybrid Rockets Using N2O/HDPE", AIAA 2019-4120, J. Propulsion and Power). CEA has no
//               HTPB in its library and CEARUN takes no user-defined reactant: Isp constant until a CEA table is given.
// CEA tables (the engine window's checks, Phase 18a fix): NASA CEA (CEA2, February 5, 2004; McBride and Gordon,
// RP-1311) run with CEARUN on 2026-11-13 (paraffin, ε = 50 at O/F 1 … 4) and 2026-11-14 (the rest): rocket problem,
// infinite area combustor, equilibrium (shifting) composition during expansion, chamber pressure 30 bar, supersonic area
// ratios Ae/At = 50 and 300; reactants from the CEA library at the temperature and enthalpy CEA printed (kJ/kg-mol):
// H2(L) 20.27 K −9,012; O2(L) 90.17 K −12,979; RP-1 298.15 K −24,717.7; CH6N2(L),MMH 298.15 K 54,200; N2O4(L) 298.15 K
// −17,549; Aerozine 50 = 50 % C2H8N2(L),UDMH (298.15 K, 48,900) + 50 % N2H4(L) (298.15 K, 50,380) by mass; paraffin
// 298.15 K −1,860,600. Rows [O/F, Ivac at ε = 50, Ivac at ε = 300] in m/s, as printed (null: that run had ε = 50 only).
// Used for: the reasonable O/F range (core.js engCea: where Ivac at ε = 50 is at least 90 % of its peak) and the
// theoretical vacuum Isp (the highest Ivac at ε = 300); the paraffin hybrid's Isp against O/F (ε = 50).
const CEA = {
  lox_lh2: [[1, 3716.7, 3930.2], [1.25, 3866.6, 4063.3], [1.5, 3991.3, 4169.7], [1.75, 4096.1, 4258.8], [2, 4184.5, 4334.5], [2.5, 4313.3, 4456.2], [3, 4396.8, 4549.3],
    [3.5, 4449.9, 4618.4], [4, 4480.9, 4666.3], [4.5, 4494.9, 4698.0], [5, 4495.1, 4716.8], [5.5, 4484.0, 4724.5], [6, 4462.9, 4722.6], [7, 4391.9, 4691.4], [8, 4268.2, 4606.3],
    [9, 4107.3, 4413.4], [9.5, 4030.7, 4323], [10, 3957.8, 4237.4]],
  lox_rp1: [[1, 2695.5, 2918.7], [1.25, 2828.2, 3048.3], [1.5, 3026.3, 3226.1], [1.75, 3215.8, 3395.8], [2, 3362.3, 3544.2], [2.25, 3458.9, 3660.8], [2.5, 3513.6, 3740.5],
    [2.75, 3529.8, 3787.6], [3, 3510.9, 3802.2], [3.5, 3428.8, 3735.7], [4, 3342.2, 3632.6], [4.5, 3259.3, 3526.3], [5, 3178.9, 3421.5]],
  nto_mmh: [[1, 3009.7, 3190.5], [1.25, 3134, 3300.3], [1.5, 3233.4, 3393.7], [1.75, 3303.7, 3471.1], [2, 3349.3, 3530.9], [2.25, 3371.8, 3571.6], [2.5, 3361.6, 3587.5],
    [2.75, 3285.5, 3491.7], [3, 3208, 3399.3], [3.5, 3063.9, 3231.9], [4, 2935.3, 3085.5], [4.5, 2820.6, 2956.8], [5, 2717.8, 2842.6]],
  nto_a50: [[1, 3072.7, 3242.6], [1.25, 3191.4, 3350], [1.5, 3279.6, 3439.1], [1.75, 3338, 3510.7], [2, 3370.2, 3561.1], [2.25, 3367.7, 3585.2], [2.5, 3281.7, 3479.3],
    [2.75, 3195.8, 3378.6], [3, 3114.8, 3285.3], [3.5, 2967.9, 3118.5], [4, 2838.9, 2974.2], [4.5, 2724.8, 2847.9], [5, 2623.3, 2736.4]],
  lox_paraffin: [[1, 2633.8, 2852.5], [1.25, 2773.0, null], [1.5, 2981.1, 3176.7], [1.75, 3179.2, null], [2, 3328.4, 3510.1], [2.25, 3424.3, 3628.1], [2.5, 3474.9, 3706.5],
    [2.75, 3483.7, 3749.1], [3, 3457.6, 3755.3], [3.25, 3417.6, null], [3.5, 3374.9, 3677.1], [3.75, 3332.5, null], [4, 3290.8, 3575.2], [4.5, 3209.9, 3470.3],
    [5, 3130.9, 3366.7], [5.5, 3053.2, 3267.3], [6, 2977.1, 3173.2]],
};
// Liquid densities (kg/m³), the tanks' volumes in the engine window's cutaway: oxygen 1141.58 at 90.1061 K (0.9915 atm)
// and hydrogen 70.8665 at 20.353 K (0.9953 atm), NIST Chemistry WebBook, saturation properties (the rows nearest 1
// atm); from PubChem (HSDB): methylhydrazine 0.874 g/cm³ at 25 °C (Merck Index 13th ed.), dinitrogen tetroxide 1.45 g/cm³
// at 20 °C (CRC Handbook 88th ed.), 1,1-dimethylhydrazine 0.791 at 22 °C and hydrazine 1.0036 at 25 °C (Merck Index);
// Aerozine 50 from those two at 50/50 by mass, ideal mixing: 1 / (0.5/791 + 0.5/1003.6) = 884.7 (derived); RP-1 0.81
// g/mL from Wikipedia's "RP-1" (a secondary source: the specification's own table was not reachable).
const RHO = { lox: 1141.58, lh2: 70.8665, rp1: 810, nto: 1450, mmh: 874, a50: 1 / (0.5 / 791 + 0.5 / 1003.6) };
const PROPS = {
  lox_lh2: { plume: 'blue', cea: 'lox_lh2', rho: { ox: RHO.lox, fuel: RHO.lh2 } },
  lox_rp1: { plume: 'orange', cea: 'lox_rp1', rho: { ox: RHO.lox, fuel: RHO.rp1 } },
  nto_a50: { plume: 'amber', cea: 'nto_a50', rho: { ox: RHO.nto, fuel: RHO.a50 } },
  nto_mmh: { plume: 'amber', cea: 'nto_mmh', rho: { ox: RHO.nto, fuel: RHO.mmh } },
  n2h4: { plume: 'faint' },
  h2o2: { plume: 'faint' },
  apcp: { plume: 'white' },
  n2o_htpb: { plume: 'amber', hyb: { a: 0.1876, n: 0.347, rho: 0, ispOF: null }, src: ['doran', 'kamps', 'wikiReg'] },
  lox_paraffin: { plume: 'amber', cea: 'lox_paraffin', hyb: { a: 9.36e-2, n: 0.62, rho: 920, ispOF: CEA.lox_paraffin.map(([of, c]) => [of, c / 9.80665]) }, src: ['kcz2007', 'cearun'] },
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
  nist: 'https://webbook.nist.gov/chemistry/fluid/',
  pubchem: 'https://pubchem.ncbi.nlm.nih.gov/',
  wikiRp1: 'https://en.wikipedia.org/wiki/RP-1',
};

if (typeof module !== 'undefined') module.exports = { ENGINES, PROPS, ENG_SRC, CEA, RHO };
