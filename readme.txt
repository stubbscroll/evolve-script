mad.js        script v1, does only mad reset
evolve.js     script v2, t1-t4 resets, pillar, lone survivor, warlord, tp3-tp4, tp od kamikaze

script that plays evolve
https://pmotschmann.github.io/Evolve/

script v1:
- mad reset

script v2:
* all tests done with ~116k plasmids, 70k antiplasmids, 200 supercoiled
  plasmids, 10k phage, 71 dark energy, 145 harmony crystals, 28 ai cores,
  almost all perks, all crispr upgrades, some servants and skilled servants
  (from overlord tour)
- mad reset implemented, should work on all races
- bioseed reset implemented
- black hole implemented
- vacuum collapse implemented
- ascension implemented
- pillar implemented, tested with various races including 4* sludge in heavy
  gravity, 4* digital ascension (synth, imitate wyvern, +4% power star sign, in
  antimatter)
- ai apocalypse implemented, tested with djinn in heavy gravity
- matrix and retirement implemented, tested with hybrid custom in heavy gravity.
  need testing in micro
- lone survivor implemented, works in antimatter, struggles with power
  elsewhere (can finish with some user intervention in these cases)
- warlord implemented, more testing is desirable (the run is LONG)
- truepath orbital decay on kamikaze planet implemented
* i assume lumber+plywood is eliminated from all runs that go to interstellar
  or farther, as well as assuming that matter replicator is unlocked

roadmap:
- add more techs to the manual list at the start of truepath: magic
  stuff, evil stuff, carnivore stuff
- currently testing:
  - avian-sludge ai apocalypse in heavy gravity, inherit mimic (heat) and slaver
  - heat-ultra sludge 4* pillar in heavy gravity, inherit djinn and slaver
  - mantis retirement in heavy gravity, inherit mimic (heat) and slaver. test
    high population in ai apocalypse (troop landers)
- more testing:
  * the aim is to make the script more robust and avoid softlocking in unusual
    situations. priority on being able to finish a run rather than efficiency
  - try with different races and traits
  - longer runs need more testing
- more tweaks to handle some likely situations
  - many skilled servants + low production => handle deficit from crafters
    (brick => cement, wrought iron => iron, sheet metal => aluminium,
    mythril => iridium, aerogel => infernite), currently a small problem in
    sludge truepath (haven't tested super sludge yet). super sludge 4* in
    falsepath is fine (so far). ideally i need a better routine for distributing
    crafters (regular and servants) that cares about deficiencies

not planned:
- more challenge runs, more resets. tp1-2 can be done by starting ai apocalypse
  and resetting early. em field happens to be possible
- my goal was to be able to farm every resource, and my script supports that
  now. warlord covers supercoiled plasmids, bloodstones, artifacts, changing of
  hybrid custom so no need to implement demonic infusion and apotheosis

usage:
- do the protoplasm phase manually
- select challenge genes (optional)
- select race and begin
- press f12 to open javascript console (firefox, chrome)
- copy/paste the contents of evolve.js to the console
- comment out the desired reset type, press enter
- wait until the script reaches the reset point, then press reset manually

some usage notes:
- in tp4 retirement and orbital decay, the game refreshes at isolation/moonfall.
  when that happens, re-paste the script
- we can manually remove/add genes in arpa->genetics (script doesn't do that)
- playing manually while the script is running is not recommended. holding the
  multiplier keys can multiply some of the script's actions and do unintended
  things. it should be fine to build the occasional building though
- in warlord, don't enable/disable mech bays manually! the script uses
  disabling to store state during the spire climb. disabling mech bays will
  make the script enter a mode where it focuses on buying purifiers/ports/
  base camps/more mech bays instead of just climbing the spire (the script
  enters this mode at around level 25-30 if it's deemed profitable)

system requirements:
- in the game, set debug mode on and preload tab content on
- no tampermonkey/greasemonkey needed (or supported)
- a somewhat recent browser that supports the Set data structure in javascript
  (probably not older than 2024)
- script assumes some power grid priorities:
  - matter replicator always lowest
  - spire: mech bay > port > base camp
  - in civics, set default job to something we want to assign workers to
    (quarry workers, scavengers etc). if set to unemployed or farmers, stuff
    like sacrificial altar will not work

progression requirements:
- governors unlocked. tasks used: assign crates, mass ejector, mech constructor.
  mech constructor must be unlocked in order to do warlord and t5+
- 25 steel from technophobe (script doesn't try to get steel)
- some metaprogression (no idea how much). i haven't really tested on lower
  progression
- matter replicator required in ascension/pillar/truepath runs, and probably
  also black hole runs

supports:
- servants and skilled servants (highly recommended to have at least a few)

stuff that's supported:
- balorg, uses combat to get titanium
- meditation chamber (capybara)
- smokehouse (carnivore races)
- slaves (balorg)
- rituals (magic universe)
- ocular powers (eye-spector)
- sacrificial altar
- tax-morale balance, not using governor task
- synth and nano, but it's a rough run with power struggles and apartments
  often losing power causing homelessness, even with late-game progression
- does spy actions (influence, sabotage), aims to purchase foreign powers
- ravenous taken into account. not tested for synth and other races with
  pseudo-food
- matter replicator, not using governor task. as a side effect, replicator
  power use is deducted from top left MW
- unicorn shrine. always builds 25 knowledge shrines, then metal only
- if we start the wrong script in a scenario, script redirects correctly

stuff that's inefficient:
- script doesn't save steel for the first factory (which is important) and can
  buy a bunch of steel horseshoes first
- script buys gps satellites when we'd rather use titanium on spaceports,
  factories, iridium mines, mining outposts (i guess we do want a few gps
  satellites though)
- for now script distributes each crafter equally among resources (at least in
  mad-land and bioseed-land), but optimizing this is extremely low priority
- the script insists on trying to be at positive power near the end of mad runs
  (with all industry buildings turned on), when it can reset faster by
  increasing the knowledge cap (and let some rock quarriers and whatever be
  turned off). it gets worse if all resources are present and we have powered
  sawmills, quarries, cement plants, mines
- when playing synth or nano, the script sees wireless signal deficit and
  builds a bunch of transmitters that can't be powered on because of power
  deficit, and for some reason the script doesn't build mines to get copper for
  coal powerplants. though the script gets out of this rut by itself after ~250
  days
- script never crafts manually or buys resources when challenge genes disabled
- bioseed: script is stalled on researching space probes, doesn't trade for
  helium-3
- bioseed: end of bioseed is slow, should build some supercolliders to reach
  desired techs faster (it aims for quantum computing). should also change to
  corpocracy (factory buff) for the last stretch
- wendigo (soul eater trait): should treat hunters like farmers, depopulate
  them unless food deficit at the start of a run. the relevant part of the code
  is a terrible mess, so it's low priority
- hell fortress and attractor beacons is probably very inefficient. but it
  works, doesn't seem to softlock, and can recover from overruns (which happen)
- truepath: script builds up to extreme degrees before researching long range
  probes. might be good for tp4/kamikaze od runs, not so good for quick
  imitation runs
- script struggles with blubber (oil production). script eventually gets to
  genetics (even with narwhalus on ashland in truepath without trading for oil),
  but it's recommended to gene-remove blubber as soon as possible

stuff that doesn't work:
- some race-specific stuff not yet implemented (wish, psychic powers)
- some universe-specific stuff (authority, alchemy) not yet implemented,
  except in warlord where authority is handled
- events in general
  - thermite gets assigned crafters like a normal resource. can cause problems
    early in the run with low aluminium production
- increased andromeda piracy and syndicate influence because of chicken trait is
  not accounted for
- script doesn't add or remove traits in arpa->genetics. this won't be
  automated either. it's recommended that the player does that in long runs
- script might not work in interstellar and beyond without matter replicator, or
  if we haven't removed plywood

bugs:
- in market and storage tabs there's sometimes garbage on the bottom
- sometimes normal servants arrive, but skilled servants don't. i don't know if
  the script is at fault. can be solved by refreshing the webpage and
  re-pasting the script
- script is softlocked when trying to buy freight yard and there are no
  crafters on wrought iron. happens very often when skilled servants don't
  arrive. should fix this, ideally script should work without skilled servants
- sometimes civic->government->mimic shows "none" despite the script having
  selected a mimic. this is a visual error, the chosen mimic is in effect
- the script doesn't stop if the game is paused, it should
- in warlord, sometimes spire supply tab doesn't display properly after
  building a transport. this prevents the script from sending supplies

warning! use at your own risk. make a save first. the script is extremely
fragile and will break on the slighest change in the game code and html design.
i assume no responsibility if the script breaks and clicks out of bounds and
spends all your prestige resources on stupid stuff in arpa->genetics or buys
dark energy bomb or buys bad blood infusions or does a hard reset. for whatever
it's worth, i've been using the script on my main save for 3-4 weeks now, but i
make backups often

just use volch's script instead
https://github.com/Vollch/Evolve-Automation

i looked a lot in volch's script to figure out how to interface with the game
