// Ready-made vehicles for the orbit maneuvers (Phase 6c-2): thrust F (N), specific impulse isp (s), wet and dry mass m0, md
// (kg), the longest single firing tMax (s) and the most ignitions nMax (0: none given); wait (s): the shortest coast
// between ignitions (none of the sources gives one: 0). Text-free: names and notes are i18n 'veh.<id>' / 'cred.veh.<id>'
// (Sources window); src: VEH_SRC keys. Every value as published, converted only by the factors given
// (1 lbf = 4.4482216 N, 1 lb = 0.45359237 kg); derived values say how.
//
// mex      ESA Mars Express orbiter with its 400 N main engine. Masses: ESA Mars Express fact sheet — launch mass 1223 kg =
//          bus 439 + lander 71 + payload 116 + propellant 427 kg; the orbiter without the lander: m0 = 1223 − 71 = 1152 kg,
//          md = 1152 − 427 = 725 kg. Engine: ESA gives "400 N"; the motor is an S400-12 (keeptrack.space record of Mars
//          Express) — ArianeGroup's apogee motor page: S400-12 "Thrust, Nominal 420N", "Specific Impulse at Nominal Point
//          318 s", "Qualified Single Burn Life 1.1 hours" (3960 s), "Qualified Cycle Life 100 cycles".
// centaur  Centaur upper stage, single engine (SEC), no payload: ULA Atlas V Launch Services User's Guide, Rev. 11 (March
//          2010), Figure 1.4.1-3: RL10A-4-2 thrust 99.2 kN, Isp 450.5 s; inert mass 2,243 kg (4X1); propellant 20,830 kg
//          LH2 & LO2 — m0 = 23,073 kg. The guide states no single-burn limit: tMax is the whole propellant load in one burn,
//          20,830 kg / ṁ (ṁ = F/(Isp·g₀) = 22.454 kg/s) = 928 s (derived). nMax 3: the guide's GSO missions use "three
//          Centaur burns" (Section 2.1.3, Park to Transfer Ascent Mission).
// csm      Apollo command and service module (Apollo 11, CSM 107), service propulsion system (Aerojet AJ10-137). Thrust:
//          Apollo 11 press kit, "20,500-pound-thrust service propulsion system" → 91,188.5 N. Isp 314.5 s: NASA NTRS
//          20100027319 (Aerojet AJ10-137 Apollo Service Module Engine). m0: press kit launch weights, command module 12,250
//          lb + service module 51,243 lb = 63,493 lb → 28,799.9 kg; propellant: Apollo Operations Handbook SM2A-03-Block
//          II-(1), p. 2.4-42 (16 July 1969), gaugeable oxidizer 24,389.10 + fuel 15,252.70 lb = 39,641.80 lb → 17,981.2 kg,
//          md = 10,818.7 kg. nMax 36: same handbook p. 2.4-43, "Support 36 restarts minimum" (750 s service life).
//          tMax 610 s: NTRS 20100027319, "an 'abort' firing of 610 seconds was demonstrated" during qualification.
// smart1   ESA SMART-1 with its PPS-1350 Hall thruster: ESA "Key Recommendations for SMART-1" (1999), "nominal thrust of 70
//          mN at 1640 s specific impulse"; ESA "SMART-1: the first spacecraft of the future", "it weighs only 367
//          kilograms"; xenon 82.5 kg at launch and the longest continuous firing, 240 hours (23 Dec 2003 – 2 Jan 2004):
//          Koppel et al., "The SMART-1 Electric Propulsion Subsystem In Flight Experience", AIAA-2004-3435 →
//          md = 367 − 82.5 = 284.5 kg, tMax = 864,000 s.
// lp       A small hydrazine craft: NASA Lunar Prospector's masses and thruster — NSSDCA spacecraft record 1998-001A: "Total
//          initial mass (fully fueled) was 296.4 kg", "137.7 kg of hydrazine" → md = 158.7 kg; "6 hydrazine monopropellant
//          22-Newton thrusters" (one of them: F = 22 N). Lunar Prospector's thruster Isp and firing limit were not found
//          published: taken from the same class of thruster, ArianeGroup's 20 N hydrazine thruster page — "Specific
//          impulse (vac) 222 to 230 sec" (230 s, the upper value) and "Longest steady state burn: 1.5 hours" (5400 s).
const VEHICLES = [
  { id: 'mex', F: 420, isp: 318, m0: 1152, md: 725, tMax: 3960, nMax: 100, wait: 0, src: ['mexEsa', 's400', 'mexMotor'] },
  { id: 'centaur', F: 99200, isp: 450.5, m0: 23073, md: 2243, tMax: 928, nMax: 3, wait: 0, src: ['avug'] },
  { id: 'csm', F: 91188.5, isp: 314.5, m0: 28799.9, md: 10818.7, tMax: 610, nMax: 36, wait: 0, src: ['a11pk', 'aoh', 'aj10'] },
  { id: 'smart1', F: 0.070, isp: 1640, m0: 367, md: 284.5, tMax: 864000, nMax: 0, wait: 0, src: ['smart1Esa', 'smart1Mass', 'koppel'] },
  { id: 'lp', F: 22, isp: 230, m0: 296.4, md: 158.7, tMax: 5400, nMax: 0, wait: 0, src: ['lpNssdca', 'cht20'] },
];
const VEH_SRC = {
  mexEsa: 'https://sci.esa.int/web/mars-express/-/47364-fact-sheet',
  s400: 'https://www.space-propulsion.com/spacecraft-propulsion/apogee-motors/index.html',
  mexMotor: 'https://keeptrack.space/satellite/27816',
  avug: 'https://www.ulalaunch.com/docs/default-source/rockets/atlasvusersguide2010.pdf',
  a11pk: 'https://www.nasa.gov/wp-content/uploads/static/apollo50th/pdf/A11_PressKit.pdf',
  aoh: 'https://www.ibiblio.org/apollo/ApolloProjectOnline/Documents/SMA2A-03-BLOCK%20II%20Volume%201%2019691015/aoh-v1-2-04-sps.pdf',
  aj10: 'https://ntrs.nasa.gov/citations/20100027319',
  smart1Esa: 'https://sci.esa.int/web/smart-1/-/13400-key-recommendations-for-smart-1',
  smart1Mass: 'https://www.esa.int/Science_Exploration/Space_Science/SMART-1/SMART-1_the_first_spacecraft_of_the_future',
  koppel: 'https://sci.esa.int/web/smart-1/-/37536-the-smart-1-electric-propulsion-subsystem-in-flight-experience',
  lpNssdca: 'https://nssdc.gsfc.nasa.gov/nmc/spacecraft/display.action?id=1998-001A',
  cht20: 'https://www.space-propulsion.com/spacecraft-propulsion/hydrazine-thrusters/20n-hydrazine-thruster.html',
};

if (typeof module !== 'undefined') module.exports = { VEHICLES, VEH_SRC };
