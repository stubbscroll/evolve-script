// evolve-playing script v2

// how it works: it's heuristics-based (basically a list of rules) and tries to
// emulate my playstyle. we have to do the protoplasm stage manually and
// pick a race, then the rest of the run is automated except for the reset.
// there are no options to set. the script is supposed to play somewhat
// efficiently and avoid doing stupid stuff. script doesn't do stuff that's
// not needed for a mad reset (doesn't touch arpa projects, a lot of techs are
// not researched). trade routes are used, but only for titanium until we have
// hunter process, and alloy/oil/uranium to speed up uranium storage, rocketry
// and mutual destruction.

//-----------------------------------------
// various general-purpose helper functions
//-----------------------------------------

// convert number string from the game to double. handles comma as thousand
// separator, handles metric suffixes
function str_to_float(q) {
	q=q.replace(/,/g,'');
	q=q.replace('K','e3').replace('M','e6').replace('G','e9').replace('T','e12').replace('P','e15').replace('E','e18').replace('Z','e21').replace('Y','e24');
	return parseFloat(q);
}

// given id tag, return float contained in innerhtml, or null if not found
function get_number_by_id(str) {
	let q=document.getElementById(str);
	if(q==null) return null;
	return str_to_float(q.innerHTML);
}

// capitalize first letter in underscored string
// TODO replace this garbage function later
// this should be rewritten on principle because a linear time thing with
// O(n^2) runtime is a travesty
// also i'm not a fan of things like str[i]=char failing silently
function str_capitalize(str) {
	let out=str[0].toUpperCase();
	for(let i=1;i<str.length;i++) {
		if(str[i-1]=='_') out+=str[i].toUpperCase();
		else out+=str[i];
	}
	return out;
}

// convert string of the type "5d 13h 5m 9s" to seconds
// input can be 'never' which is a special case
// used on time left variable from evolve.global.city.buildings
function convert_to_seconds(time) {
	if(time==null || time=='never') return NaN;
	let a=time.split(' ');
	let seconds=0;
	for(let v of a) {
		let value=parseInt(v);
		let unit=v[v.length-1];
		if(unit=='s') seconds+=value;
		else if(unit=='m') seconds+=value*60;
		else if(unit=='h') seconds+=value*3600;
		else if(unit=='d') seconds+=value*24*3600;
	}
	return seconds;
}

function getchildbyclassname(q,str) {
	for(let i=0;i<q.childNodes.length;i++) if(q.childNodes[i].className==str) {
		return q.childNodes[i];
	}
	return null;
}

//----------------------------------
// global variables containing state
//----------------------------------

// these are the only states the script keeps
// i guess i could abuse the message log for state variables...
var global={
	change_government:'', // contains government to change to
	spy_action:'',        // which spy action to do ('sabotage','influence','incite','purchase')
	spy_id:-1,            // need spy id for the above
	bioseed_action:'',    // 'ship_and_probes': queue bioseeder ship and all probes,
	                      // 'prep_ship': prep ship (and queue more space probes)
};

//----------------------
// settings for all runs
//----------------------

var settings={
	gather_amount:50,
	crate_reserve:1000,         // crate construction reserve
	container_reserve:1000,     // container construction reserve
	slaver_buy_threshold:10000, // added to buy price
	spy_buy_threshold:100000,   // added to the spy cost
	spy_purchase_power_thresholds:[2500000,2000000,4500000],
	depopulate_farmer_threshold:5000, // depopulate farmers with food above this value. should be low because of ravenous
	replicator_power_buffer:5,
};

//----------------------------------------------------
// helper functions that access DOM and game variables
// a lot of these get called directly though
//----------------------------------------------------

/* about return values:
   thing_exists(), has_thing() functions return true or false
   get_thing() functions return the thing, or null (some exceptions exist)
*/

// TODO rewrite to use variables
// evolve.global.queue
// also, research queue in evolve.global.rqueue
function is_build_queue_empty() {
	let q=document.getElementById('buildQueue');
	if(q==null) return true; // that's true, nothing is queued if queue doesn't exist
	let str=q.firstChild?.innerHTML;
	if(str==undefined) return true;
	let pos=str.indexOf('(0/');
	return pos>=0;
}

// check if variable exists under evolve.global
// applicable for city, space, arpa
// also interstellar, andromeda, hell, edenic, dunno their id yet
function tab_exists(id) {
	return evolve.global.hasOwnProperty(id);
}

function resource_exists(resource) {
	if(!evolve.global.resource.hasOwnProperty(resource)) return false;
	return evolve.global.resource[resource].display?true:false;
}

function get_resource(resource) {
	if(!resource_exists(resource)) return null;
	return evolve.global.resource[resource];
}

// return production per second of a resource as a double, or NaN if not found
// to force it to always fail numerical comparisons.
// resource name (string) must start with an uppercase letter.
// TODO make sure returned value is after mass ejecting, hell transporting,
// rituals, trade routes etc
function get_production(resource) {
	if(!resource_exists(resource)) return NaN;
	return get_resource(resource).diff;
}

// return ratio of stockpile that decays per tick
function ravenous_percentage(rank) {
	if(rank<1) return .5;
	else if(rank==1) return 1./3;
	else return .25;
}

// return food production excluding decay from ravenous
// if we didn't care about this everyone would end up as farmers
function get_ravenous_food_production() {
	if(!resource_exists('Food')) return NaN;
	if(!has_trait('ravenous')) return get_resource('Food').diff;
	let food=get_resource('Food').diff;
	food+=get_resource('Food').amount*ravenous_percentage(evolve.global.race.ravenous);
	return food;
}

// return rank if current race has trait, otherwise return null
function get_trait_level(trait) {
	if(!evolve.global.race.hasOwnProperty(trait)) return null;
	return evolve.global.race[trait];
}

// check if trait exists
function has_trait(trait) {
	return get_trait_level(trait)!=null;
}

// checks tech and tech-level. look up these in DOM or something. the wiki
// doesn't have the internal names!
function has_tech(tech,techlevel=-1) {
	if(techlevel<0) console.log('has_tech error, second parameter missing');
	if(!evolve.global.tech.hasOwnProperty(tech)) return false;
	return evolve.global.tech[tech]>=techlevel;
}

function building_exists(where,what=null) {
	if(what==null) console.log('ERROR, building_exists needs 2 parameters, got:',where);
	if(!tab_exists(where)) return false;
	return evolve.global[where].hasOwnProperty(what);
}

function get_building(where,what) {
	if(!building_exists(where,what)) return null;
	return evolve.global[where][what];
}

function get_building_count(where,what) {
	let b=get_building(where,what);
	if(b==null) return 0;
	return b.count;
}

// get time left to building given building
function production_time_left(where,what) {
	if(!building_exists(where,what)) return null;
	return convert_to_seconds(evolve.global[where][what].time);
}

// get current population
function get_population() {
	return evolve.global.resource[evolve.global.race.species].amount;
}

function get_max_population() {
	return evolve.global.resource[evolve.global.race.species].max;
}

// return the number of crafting resources
function num_crafting_materials() {
	let num=0;
	for(let mat in evolve.craftCost) if(evolve.global.resource[mat]?.display) num++;
	return num;
}

// return the race's genera (can be two)
function get_genera() {
	// don't know how to find both genera of hybrid races, stupid solution for now
	if(evolve.global.race.species=='hybrid') return [evolve.global.race.maintype,evolve.global.custom.race1.hybrid[1]];
	else if(evolve.global.race.species=='dwarf') return ['humanoid','small'];
	else if(evolve.global.race.species=='raccon') return ['carnivore','herbivore'];
	else if(evolve.global.race.species=='lichen') return ['plant','fungi'];
	else if(evolve.global.race.species=='wyvern') return ['avian','reptilian'];
	else if(evolve.global.race.species=='beholder') return ['eldritch','giant'];
	else if(evolve.global.race.species=='djinn') return ['sand','fey'];
	else if(evolve.global.race.species=='narwhal') return ['aquatic','polar'];
	else if(evolve.global.race.species=='bombardier') return ['insectoid','heat'];
	else if(evolve.global.race.species=='nephilim') return ['demonic','angelic'];
	else return [evolve.global.race.maintype];
}

function get_mimic() {
	return evolve.global.race?.ss_genus;
}

// don't rely on classname="action vb", actually check if we have the resources.
// return true if we can afford, false otherwise
// newest version. we lose scalar
// didn't work: use DOM to extract costs (they were sometimes outdated)
// didn't work: evolve.actions.where.what.cost, sometimes returned non-existing
//              resources (lumber when we have heat genus)
function can_afford_thing(where,what,where2=null) {
	if(where2) return evolve.checkAffordable(evolve.actions[where][where2][what],false,false);
	return evolve.checkAffordable(evolve.actions[where][what],false,false);
}

// return true if we have enough caps to theoretically afford
function can_afford_at_max(where,what,where2=null) {
	if(where2) return evolve.checkAffordable(evolve.actions[where][where2][what],true,false);
	return evolve.checkAffordable(evolve.actions[where][what],true,false);
}

// research a tech that's not in the avoidlist
// have to vue-click in here, no click caller in global variable
// return true if we clicked
function research_tech(avoidlist) {
	// can either get id with the short, generic-ish name 'tech', or get id
	// with the name 'mTabResearch' and do a hideous access 3 layers deep
	let q=document.getElementById('tech');
	if(q==null) return false;
	for(let i=0;i<q.childNodes.length;i++) if(q.childNodes[i].id.substring(0,5)=='tech-') {
		let techname=q.childNodes[i].id.slice(5);
		if(avoidlist.has(techname)) continue;
		// check if tech is affordable
		if(!can_afford_thing('tech',techname)) continue;
		// can't buy precognition tech
		if(q.childNodes[i].firstChild.className.includes('precog')) continue;
		q.childNodes[i].__vue__.action();
		return true;
	}
	return false;
}

// appoint a governor. requires that none is currently set
function set_governor(governor) {
	if(!has_tech('governor',1)) return false;
	let cand=evolve.global.race.governor?.candidates;
	if(cand) {
		for(let i=0;i<cand.length;i++) if(cand[i].bg==governor) {
			document.getElementById('candidates').__vue__.appoint(i);
			return true;
		}
	}
	return false;
}

// needs vue i guess
// TODO rewrite this function to be similar to factory and trading
function set_smelter_output(iron,steel,iridium) {
	let smelter=get_building('city','smelter');
	if(smelter!=null) {
		let oldiron=smelter.Iron;
		let oldsteel=smelter.Steel;
		let oldiridium=smelter.Iridium;
		let q=document.getElementById('iSmelter');
		if(q==null) return;
		q=q.__vue__;
		while(oldiron>iron) q.subMetal('Iron'),oldiron--;
		while(oldsteel>steel) q.subMetal('Steel'),oldsteel--;
		while(oldiridium>iridium) q.subMetal('Iridium'),oldiridium--;
		while(oldiron<iron) q.addMetal('Iron'),oldiron++;
		while(oldsteel<steel) q.addMetal('Steel'),oldsteel++;
		while(oldiridium<iridium) q.addMetal('Iridium'),oldiridium++;
	}
}

// set a single resource to amount
// TODO rewrite this function to be similar to factory and trading
function set_nanite_input(resource,amount) {
	let q=document.getElementById('iNFactory');
	if(q!=null) {
		q=q.__vue__;
		let res=evolve.global.city.nanite_factory[resource];
		if(res!=null) {
			while(res<amount) q.addItem(resource),res++;
			while(res>amount) q.subItem(resource),res--;
		}
	}
}

// return factory capacity
// TODO add other factories
function get_num_factory_production_lines() {
	let num=0;
	if(building_exists('city','factory')) num+=evolve.global.city.factory.count;
	if(building_exists('space','red_factory')) num+=evolve.global.space.red_factory.count;
	return num;
}

// set factory production
// input is a list where each item takes 2 slots:
// [resource1, amount1, resource2, amount2 etc]
// resources not given are set to 0
// warning: the vue interface lets us set production to elements not discovered,
// and it's impossible to change that back in the game's ui until we discover
// said element
function set_factory_production(list) {
	if(!Array.isArray(list)) { console.log('set_factory_production: expected list'); return; }
	let ids=['Lux','Furs','Alloy','Polymer','Nano','Stanene'];
	let res=['Money','Furs','Alloy','Polymer','Nano_Tube','Stanene'];
	let current=[0,0,0,0,0,0];
	let desired=[0,0,0,0,0,0];
	let q=document.getElementById('iFactory');
	if(q==null) { console.log('error, factory not found'); return; }
	// get current settings
	for(let i=0;i<6;i++) {
		current[i]=evolve.global.city.factory[ids[i]];
		if(current[i]>0 && !resource_exists(res[i])) {
			console.log('sanity error, factory set to',res[i],'which doesn\'t exist. fixing now');
			while(current[i]>0) q.__vue__.subItem(ids[i]),current[i]--;
		}
	}
	let num=list.length;
	for(let i=0;i<num;i+=2) {
		let j=ids.indexOf(list[i]);
		if(!resource_exists(res[j])) { console.log('factory error, trying to produce non-existing element',res[j]); return; }
		if(j<0) { console.log('invalid factory id',list[i]); return; }
		desired[j]=list[i+1];
	}
	// vue add/sub doesn't take amount
	// first pass: decrease
	for(let i=0;i<6;i++) while(current[i]>desired[i]) q.__vue__.subItem(ids[i]),current[i]--;
	// second pass: increase
	for(let i=0;i<6;i++) while(current[i]<desired[i]) q.__vue__.addItem(ids[i]),current[i]++;
}

function get_factory_production(res) {
	let q=document.getElementById('iFactory');
	if(res=='Lux') return q.__vue__.Lux;
	else if(res=='Furs') return q.__vue__.Furs;
	else if(res=='Alloy') return q.__vue__.Alloy;
	else if(res=='Polymer') return q.__vue__.Polymer;
	else if(res=='Nano') return q.__vue__.Nano;
	else if(res=='Stanene') return q.__vue__.Stanene;
	else return null;
}

function set_mining_droid_production(list) {
	if(!Array.isArray(list)) { console.log('set_mining_droid_production: expected list'); return; }
	let ids=['adam','uran','coal','alum'];
	let res=['Adamantite','Uranium','Coal','Aluminium'];
	let current=[0,0,0,0];
	let desired=[0,0,0,0];
	let q=document.getElementById('iDroid');
	if(q==null) { console.log('error, factory not found'); return; }
	// get current settings
	for(let i=0;i<4;i++) {
		current[i]=evolve.global.interstellar.mining_droid[ids[i]];
		if(current[i]>0 && !resource_exists(res[i])) {
			console.log('sanity error, mining_droid set to',res[i],'which doesn\'t exist. fixing now');
			while(current[i]>0) q.__vue__.subItem(ids[i]),current[i]--;
		}
	}
	let num=list.length;
	for(let i=0;i<num;i+=2) {
		let j=ids.indexOf(list[i]);
		if(!resource_exists(res[j])) { console.log('mining droid error, trying to produce non-existing element',list[i]); return; }
		if(j<0) { console.log('invalid factory id',list[i]); return; }
		desired[j]=list[i+1];
	}
	// vue add/sub doesn't take amount
	// first pass: decrease
	for(let i=0;i<4;i++) while(current[i]>desired[i]) q.__vue__.subItem(ids[i]),current[i]--;
	// second pass: increase
	for(let i=0;i<4;i++) while(current[i]<desired[i]) q.__vue__.addItem(ids[i]),current[i]++;

}

// list of all structures with sublocations
const sublocation=new Map([
// space - home
	['space-test_launch','spc_home'],
	['space-satellite','spc_home'],
	['space-gps','spc_home'],
	['space-propellant_depot','spc_home'],
	['space-nav_beacon','spc_home'],
// space - moon
	['space-moon_mission','spc_moon'],
	['space-moon_base','spc_moon'],
	['space-iridium_mine','spc_moon'],
	['space-helium_mine','spc_moon'],
	['space-observatory','spc_moon'],
// space - red planet (mars)
	['space-red_mission','spc_red'],
	['space-spaceport','spc_red'],
	['space-red_tower','spc_red'],
	['space-living_quarters','spc_red'],
	['space-garage','spc_red'],
	['space-red_mine','spc_red'],
	['space-fabrication','spc_red'],
	['space-red_factory','spc_red'],
	['space-biodome','spc_red'],
	['space-ziggurat','spc_red'],
	['space-space_barracks','spc_red'],
	['space-exotic_lab','spc_red'],
// space - hell planet (mercury)
	['space-hell_mission','spc_hell'],
	['space-geothermal','spc_hell'],
	['space-spc_casino','spc_hell'],
	['space-swarm_plant','spc_hell'],
// space - sun
	['space-sun_mission','spc_sun'],
	['space-swarm_control','spc_sun'],
	['space-swarm_satellite','spc_sun'],
// space - gas planet (jupiter)
	['space-gas_mission','spc_gas'],
	['space-gas_mining','spc_gas'],
	['space-gas_storage','spc_gas'],
	['space-star_dock','spc_gas'],
// space - gas moon (ganymede)
	['space-gas_moon_mission','spc_gas_moon'],
	['space-outpost','spc_gas_moon'],
	['space-oil_extractor','spc_gas_moon'],
// space - asteroid belt
	['space-belt_mission','spc_belt'],
	['space-space_station','spc_belt'],
	['space-elerium_ship','spc_belt'],
	['space-iridium_ship','spc_belt'],
	['space-iron_ship','spc_belt'],
// space - dwarf planet (ceres)
	['space-dwarf_mission','spc_dwarf'],
	['space-e_reactor','spc_dwarf'],
	['space-world_collider','spc_dwarf'],
// interstellar - alpha centauri
	['interstellar-alpha_mission','int_alpha'],
	['interstellar-starport','int_alpha'],
	['interstellar-habitat','int_alpha'],
	['interstellar-mining_droid','int_alpha'],
	['interstellar-processing','int_alpha'],
	['interstellar-fusion','int_alpha'],
	['interstellar-laboratory','int_alpha'],
	['interstellar-g_factory','int_alpha'],
	['interstellar-warehouse','int_alpha'],
// interstellar - proxima centauri
	['interstellar-proxima_mission','int_proxima'],
	['interstellar-xfer_station','int_proxima'],
	['interstellar-cruiser','int_proxima'],
// interstellar - helix nebula
	['interstellar-nebula_mission','int_nebula'],
	['interstellar-harvester','int_nebula'],
	['interstellar-elerium_prospector','int_nebula'],
	['interstellar-nexus','int_nebula'],
// interstellar - neutron
	['interstellar-neutron_mission','int_neutron'],
	['interstellar-neutron_miner','int_neutron'],
	['interstellar-citadel','int_neutron'],
	['interstellar-stellar forge','int_neutron'],
// interstellar - blackhole
	['interstellar-blackhole_mission','int_blackhole'],
	['interstellar-far_reach','int_blackhole'],
	['interstellar-stellar_engine','int_blackhole'],
	['interstellar-mass_ejector','int_blackhole'],
	['interstellar-jump_ship','int_blackhole'],
	['interstellar-wormhole_mission','int_blackhole'],
	['interstellar-stargate','int_blackhole'],
// portal - fortress
	['portal-turret','prtl_fortress'],
	['portal-carport','prtl_fortress'],
	['portal-repair_droid','prtl_fortress'],
	['portal-war_droid','prtl_fortress'],
]);

// build a building. return true if we succeeded
// changed to vue-click, evolve.actions-click didn't update ui
function build_structure(list) {
	// special cases: stuff not in evolve.global.location.building
	// missions are typically here
	let special_cases=['city-slave_market','city-assembly','space-test_launch','space-moon_mission','space-red_mission','space-hell_mission','space-sun_mission','space-gas_mission','space-gas_moon_mission','space-belt_mission','space-dwarf_mission','city-horseshoe','interstellar-alpha_mission','interstellar-proxima_mission','interstellar-nebula_mission','interstellar-neutron_mission','interstellar-blackhole_mission'];
	if(!Array.isArray(list)) { console.log('build_structure: expected list, got',list); return false; } // must be an array of buildings
	for(let id of list) {
		let minus=id.indexOf('-');
		if(minus==-1) console.log('build structure: error, no minus in',id);
		let where=id.substring(0,minus);
		let what=id.slice(minus+1);
		let where2=sublocation.get(id);
		if(!tab_exists(where)) continue;
		// special cases that don't exist in evolve.global
		if(special_cases.includes(id) || evolve.global[where][what]!=null) {
			if(can_afford_thing(where,what,where2)) {
				let q=document.getElementById(id);
				// q can actually be 0 here. somehow city-rock_quarry with synth
				// imitating ent gets past the previous test
				if(!q) continue;
				q.__vue__.action();
				return true;
			}
		}
	}
	return false;
}

// build up to max one of a building
function build_one(list) {
	if(!Array.isArray(list)) { console.log('build_one: expected list'); return false; } // must be an array of buildings
	for(let id of list) {
		let minus=id.indexOf('-');
		if(minus==-1) console.log('build one: error, no minus in',id);
		let where=id.substring(0,minus);
		let what=id.slice(minus+1);
		if(get_building_count(where,what)<1 && build_structure([id])) return true;
	}
	return false;
}

// return the number of buildings of given type
function num_structures(id) {
	let minus=id.indexOf('-');
	if(minus==-1) console.log(id,'probably error, called num_structure without minus with');
	let where=id.substring(0,minus);
	let what=id.slice(minus+1);
	if(!evolve.global.hasOwnProperty(where)) return null;
	if(!evolve.global[where].hasOwnProperty(what)) return null;
	return evolve.global[where][what].count;
}

// get enabled/disabled status for building
function get_enabled_disabled(id) {
	let q=document.getElementById(id);
	if(q==null) return null;
	let on,off;
	let str=q.__vue__.on_label();
	let pos=str.indexOf(': ');
	on=parseInt(str.slice(pos+2));
	str=q.__vue__.on_label();
	pos=str.indexOf(': ');
	off=parseInt(str.slice(pos+2));
	return [on,off];
}

function disable_building(id) {
	let q=document.getElementById(id);
	if(q==null) return null;
	q.__vue__.power_off();
}

function enable_building(id) {
	let q=document.getElementById(id);
	if(q==null) return null;
	q.__vue__.power_on();
}

// return false if it failed
function set_governor_task(task) {
	if(!has_tech('governor',1)) return false;
	let actualname='';
	// first check if we already have task
	for(let i=0;i<6;i++) if(evolve.global.race.governor.tasks['t'+i]==task) return false;
	// find free slot
	for(let i=0;i<6;i++) if(evolve.global.race.governor.tasks['t'+i]=='none') {
		if(task=='bal_storage') actualname='Crate/Container Management';
		// more hideous traversal. can return null if we have less than 6 slots
		let q=document.getElementById('govOffice')?.childNodes[i+1]?.childNodes[1]?.childNodes[2]?.firstChild;
		if(q!=null) for(let j=0;j<q.childNodes.length;j++) {
			let s=q.childNodes[j];
			if(s.innerHTML==actualname) {
				s.click();
				return true;
			}
		}
	}
	return false;
}

// handle government change modal. if user spawned it, do nothing
function government_modal() {
	let q=document.getElementById('govModal');
	if(q!=null && global.change_government!='' && evolve.global.civic.govern.type!=global.change_government) {
//	console.log('change from',evolve.global.civic.govern.type,'to',global.change_government);
		q.__vue__.setGov(global.change_government);
		global.change_government=''; 
		return true;
	}
	return false;
}

function spy_action_modal() {
	if(global.spy_action=='') return false; // return, modal spawned by user
	let q=document.getElementById('espModal');
	if(q==null) return;
	// several vue variables:
	// q.__vue__.act = ?
	// q.__vue__.anx = true if annexed i think
	// q.__vue__.buy = true if bought i think
	// q.__vue__.eco = economy strength i guess
	// q.__vue__.esp = ?
	// q.__vue__.hstl = hostility
	// q.__vue__.mil = military strength
	// q.__vue__.occ = true if occupied by force i guess
	// q.__vue__.sab = ?
	// q.__vue__.trn = ?
	// q.__vue__.unrest = unrest level i guess
	if(['influence','sabotage','incite','annex'].includes(global.spy_action)) {
		q.__vue__[global.spy_action](global.spy_id);
		global.spy_action='';
		global.spy_id=-1;
		return true;
	} else if(global.spy_action=='purchase') {
		q.__vue__[global.spy_action](global.spy_id);
		global.spy_action='';
		global.spy_id=-1;
		return true;		
	}
	return false;
}

function is_spacedock_modal_open() {
	let q=document.getElementById('modalBox');
	if(q==null) return false;
	// since the title is generic, check if this is actually the space dock modal
	let r=q.firstChild?.innerHTML;
	return r!=undefined && r=='Space Dock';
}

function spacedock_modal() {
	if(global.bioseed_action=='') return false; // return, modal spawned by user
	let q=document.getElementById('modalBox');
	if(q==null) return false;
	// since the title is generic, check if this is actually the space dock modal
	let r=q.firstChild?.innerHTML;
	if(r==undefined && r!='Space Dock') return false;
	// space dock confirmed
	if(global.bioseed_action=='ship_and_probes') {
		// click 100 times on bioseeder ship to be guaranteed to finish it
		let s=document.getElementById('starDock-seeder');
		if(s==undefined) { console.log('error, bioseeder ship vue not found'); return false; }
		for(let i=0;i<100;i++) s.__vue__.action();
		// click 40 times on space probes to fill queue
		s=document.getElementById('starDock-probes');
		if(s==undefined) { console.log('error, space probes vue not found'); return false; }
		if(s!=undefined) for(let i=0;i<40;i++) s.__vue__.action();
		global.bioseed_action='';
		// close modal
		// TODO not tested
		q=q.nextSibling.click();
		return true;
	} else if(global.bioseed_action=='prep_ship') {
		let s=document.getElementById('starDock-prep_ship');
		if(s==undefined) { console.log('error, prep ship vue not found'); return false; }
		s.__vue__.action();
		global.bioseed_action='';
		q=q.nextSibling.click();
		return true;
	}
	return false;
}

function perform_spy_action(id,spy_action) {
	let q=document.getElementById('foreign');
	if(q==null) return false;
	let r=document.getElementById('gov'+id).childNodes[2].childNodes[2].firstChild;
	// check if espionage button is clickable
	if(r!=null && r.getAttribute('disabled')==null) {
		global.spy_action=spy_action;
		global.spy_id=id;
		r.click();
		return true;
	}
	return false;
}

// return true if we spawned modal
function change_government(government) {
	// exit if we haven't researched government
	if(!has_tech('govern',1)) return false;
	let q=document.getElementById('govType');
	if(q!=null) {
		// bleh terrible traversal
		q=q.childNodes[1].firstChild.firstChild;
		if(q.getAttribute('disabled')==null) {
			global.change_government=government;
			q.click();
			return true;
		}
	}
	return false;
}

// general modal handler. return true if script clicked something
function handle_modals() {
	if(government_modal()) return true;
	if(spy_action_modal()) return true;
	if(spacedock_modal()) return true;
	return false;
}

//----------------------------------
// stuff specific for magic universe
//----------------------------------

function increase_ritual(resource) {
	let q=document.getElementById('iPylon');
	if(q!=null) q.__vue__.addSpell(resource);

}

function decrease_ritual(resource) {
	let q=document.getElementById('iPylon');
	if(q!=null) q.__vue__.subSpell(resource);
}

//------------------------------
// shared code for all run types
//------------------------------

// don't research reset-related techs
const tech_avoid_safeguard=new Set(['demonic_infusion','purify_essence','procotol66','incorporeal','dial_it_to_11','limit_collider']);

// "manually" gather resources
// TODO should i change to vue-actions here? i guess it's fine until proven not fine
function gather_all() {
	// disabled in magic for now
	// dunno if any basic resource gathering action has a cost elsewhere
	if(evolve.global.race.universe=='magic') return;
	for(let resource of ['food','lumber','chrysotile','stone']) {
		var Resource=str_capitalize(resource);
		if(evolve.global.resource[Resource].display) {
			for(let i=0;i<settings.gather_amount;i++) evolve.actions.city[resource].action();
		}
	}
}

// set mimic according to given priority list. if we already have a genus,
// pick the next from the list.
// kindling kindred causes heat to be skipped (not sure if that's good)
function set_mimic(genuslist) {
	if(get_max_population()==0) return false;
	let genera=get_genera();
	for(let i=0;i<genuslist.length;i++) {
		let genus=genuslist[i];
		if(genus in genera) continue; // matches current genus, pick next
		if(genus=='heat' && has_trait('kindling_kindred')) continue;
		let name;
		// drop-down list has only english string, no identifiers
		// TODO maybe look up localised string
		if(genus=='humanoid') name='Humanoid';
		else if(genus=='carnivore') name='Carnivorous Beast';
		else if(genus=='herbivore') name='Herbivorous Beat';
		else if(genus=='small') name='Small';
		else if(genus=='giant') name='Giant';
		else if(genus=='reptilian') name='Reptilian';
		else if(genus=='avian') name='Avian';
		else if(genus=='insectoid') name='Insectoid';
		else if(genus=='plant') name='Plant';
		else if(genus=='fungi') name='Fungi';
		else if(genus=='aquatic') name='Aquatic';
		else if(genus=='fey') name='Fey';
		else if(genus=='heat') name='Heat';
		else if(genus=='polar') name='Polar';
		else if(genus=='sand') name='Sand';
		else if(genus=='demonic') name='Demonic';
		else if(genus=='angelic') name='Angelic';
		let q=document.getElementById('sshifter');
		if(q!=null && q.childNodes.length>2) {
			let r=q.childNodes[2].childNodes[2].firstChild;
			for(let i=0;i<r.childNodes.length;i++) if(r.childNodes[i].innerHTML==name) {
				r.childNodes[i].click();
				return;
			}
		}
	}
	return false;
}

// distribute workers equally among all jobs in subcategory
// (only used for servants and skilled servants, technically compatible
// with crafters as long as there's no scarletite or quantium)
// parameters:
// - joblist: pointer into job list parent in DOM
// - max: max number of workers
function assign_jobs_equally(joblist,max) {
	if(joblist==0) return; // not found in DOM, abort
	let n=joblist.childNodes.length; // number of entries in job list
	if(n==0) return;       // no child nodes, abort
	let active=0;                    // number of active jobs
	let amount=[];                  // currently assigned workers to job i
	let visible=[];                 // true=visible
	for(let i=1;i<n;i++) { // start at 1, first entry is header
		let q=joblist.childNodes[i];
		if(q.hasAttribute('style') && q.getAttribute('style')!='') continue;
		active++;
		visible[i]=true;
		amount[i]=q.firstChild.childNodes[1].innerHTML;
	}
	if(active==0) return; // no jobs to assign to, abort silently
	for(let i=1;i<n;i++) if(visible[i]) {
		let q=joblist.childNodes[i];
		while(amount[i]>0) {
			q.childNodes[1].childNodes[0].click();
			amount[i]--;
		}
	}
	for(let i=1;i<n;i++) if(visible[i]) {
		let desired=Math.trunc(max/active);
		let q=joblist.childNodes[i];
		while(desired>amount[i]) {
			q.childNodes[1].childNodes[1].click();
			amount[i]++;
		}
	}
	for(let i=1;i<n;i++) if(visible[i]) {
		let desired=Math.trunc(max/active);
		let q=joblist.childNodes[i];
		q.childNodes[1].childNodes[1].click();
	}
}

// craft='eq': divide crafters equally among resources
// craft is resource name: all in that resource (ex: craft='Brick')
// craft is '1'+resource name (prefix is digit one): all in that resource,
// except have 1 in the remaining resources. the use case is when we don't have
// a skilled servant on each crafting resource
function apply_population_changes(craft,jobs) {
	let numcrafters=0;
	if(jobs.hasOwnProperty('craftsman')) numcrafters=jobs['craftsman'].desired;
	let numuncappedcrafters=0; // number of uncapped crafter jobs
	let spent=0;
	let one=(craft[0]=='1');
	if(one) craft=craft.slice(1);
	// add crafter jobs to data structure
	for(let res in evolve.craftCost) {
		let mat=evolve.global.resource[res];
		if(!mat?.display) continue;
		let desired=0,current=0,max=0;
		// need to access DOM for current and max number of crafters
		let q=document.getElementById('craft'+res);
		if(q!=null) {
			let value=q.childNodes[1].innerHTML,slash=value.indexOf('/');
			let jobtype;
			if(slash==-1) {
				jobtype='crafter'; // uncapped crafter
				current=parseInt(value);
				max=-1;
			} else {
				jobtype='limitcrafter'; // capped crafter
				current=parseInt(value.substring(0,slash));
				max=parseInt(value.slice(slash+1));
			}
			// only add if uncapped or max>0
			if(max<0) numuncappedcrafters++;
			if(max!=0) jobs[res]={jobtype,desired,current,max};
		}
	}
	// assign crafters
	// one in each job, unless set to all-in
	if(craft=='eq' || one) {
		for(let job in jobs) if(jobs[job].jobtype=='crafter' && spent<numcrafters) spent++,jobs[job].desired++;
	}
	// always fill capped jobs if we can, because scarletite and quantium seems
	// to be always needed
	for(let job in jobs) if(spent<numcrafters && jobs[job].jobtype=='limitcrafter') {
		jobs[job].desired=jobs[job].max;
		spent+=jobs[job].max;
		if(spent+jobs[job].max>numcrafters) jobs[job].desired=numcrafters-spent,spent=numcrafters;
	}
	if(craft=='eq') {
		// distribute equally
		let amount=Math.trunc((numcrafters-spent)/numuncappedcrafters);
		let i=0;
		for(let job in jobs) if(jobs[job].jobtype=='crafter') {
			jobs[job].desired+=amount+(i<(numcrafters-spent)%numuncappedcrafters?1:0);
			i++;
		}
	} else {
		// dump all in one resource
		jobs[craft].desired+=numcrafters-spent;
		spent=numcrafters;
	}
//for(job in jobs) console.log(job,'desired',jobs[job].desired,'current',jobs[job].current,'max',jobs[job].max);
	// set the desired number of workers in the UI
	// first pass: reduce
	for(let job in jobs) if(job!='craftsman' && job!='crew' && jobs[job].desired<jobs[job].current) {
		let id,q;
		if(jobs[job].jobtype=='crafter' || jobs[job].jobtype=='limitcrafter') {
			id='craft'+job;
			q=document.getElementById(id).nextSibling.childNodes[0];
		} else {
			id='civ-'+job;
			q=document.getElementById(id).childNodes[1].childNodes[0];
		}
		while(jobs[job].desired<jobs[job].current) q.click(),jobs[job].current--;
	}
	// second pass: increase
	for(let job in jobs) if(job!='craftsman' && job!='crew' && jobs[job].desired>jobs[job].current) {
		let id,q;
		if(jobs[job].jobtype=='crafter' || jobs[job].jobtype=='limitcrafter') {
			id='craft'+job;
			q=document.getElementById(id).nextSibling.childNodes[1];
		} else {
			id='civ-'+job;
			q=document.getElementById(id).childNodes[1].childNodes[1];
		}
		while(jobs[job].desired>jobs[job].current) q.click(),jobs[job].current++;
	}
}

// only assigns to crafters as a category, not to individual materials
// craft: crafter settings, it's just passed on to apply_population_changes
// miners=false: don't use miners (used when copper and iron production in space is good)
// coalminers=false: don't use coal miners (used when coal production in interstellar is good)
// TODO support colonists (highest priority), titan colonists (also highest
// priority), space miners, archaeologists, ship crew (depopulate other stuff if
// they aren't maxed out), surveyors, ghost trappers, elysium miners,
// pit miners. also meditators, teamsters i guess
function assign_population(craft,miners=true,coalminers=true,surveyors='none') {
	// must have unlocked civics tab, must have >0 max population?
	if(evolve.global.resource[evolve.global.race.species].max==0) return;
	let jobs={};
	for(let jobname in evolve.global.civic) if(evolve.global.civic[jobname].hasOwnProperty('job') && evolve.global.civic[jobname].display==true) {
		let q=evolve.global.civic[jobname];
		let jobtype,desired=0,current=q.workers,max=q.max;
		jobtype=max<0?'basic':'nonbasic';
		jobs[jobname]={jobtype,current,desired,max};
	}
	// adjust the number of farmers depending on storage and production
	let spent=0; // number of workers assigned
	let population=evolve.global.resource[evolve.global.race.species].amount;
	if('farmer' in jobs) {
		jobs['farmer'].desired=jobs['farmer'].current;
		if(get_ravenous_food_production()<0) {
			// food deficit: add 1 more farmer
			jobs['farmer'].desired++;
		} else if(evolve.global.resource.Food.amount>settings.depopulate_farmer_threshold) {
			jobs['farmer'].desired--;
			if(jobs['farmer'].desired<0) jobs['farmer'].desired=0;
		}
		spent=jobs['farmer'].desired;
	}
	if('crew' in jobs) spent+=jobs.crew.current;
	// have at least 1 crafter per crafted material
	let mat=num_crafting_materials();
	if(mat>0 && evolve.global.civic.craftsman.display) {
		// reduce if we don't have enough crafters
		if(mat>evolve.global.civic.craftsman.max) mat=evolve.global.civic.craftsman.max;
		jobs['craftsman'].desired+=mat;
		spent+=mat;
	}
	// assign 1 to each job except scavenger, tormentor, priest
	for(let job in jobs) {
		if('farmer' in jobs) {
			// even if we starve, we really want to produce a little bit of each thing
			while(spent>=population && jobs['farmer'].desired>1) {
				jobs['farmer'].desired--; spent--;
			}
		}
		if(job=='unemployed' || job=='farmer' || job=='scavenger' || job=='priest' || job=='craftsman' || job=='hell_surveyor') continue;
		if((job=='miner' && !miners) || (job=='coal_miner' && !coalminers)) continue;
		if(jobs[job].desired==0 && jobs[job].max!=0) {
			jobs[job].desired=1;
			spent++;
		}
	}
	// space miners, colonists, titan colonists are important and are filled first
	for(let job in jobs) if(job=='space_miner' || job=='colonist' || job=='titan_colonist') {
		// use actual amount of assigned space miners
		if(job=='space_miner') {
			jobs[job].max=0;
			if(building_exists('space','elerium_ship')) jobs[job].max+=get_building('space','elerium_ship').count*2;
			if(building_exists('space','iridium_ship')) jobs[job].max+=get_building('space','iridium_ship').count;
			if(building_exists('space','iron_ship')) jobs[job].max+=get_building('space','iron_ship').count;
		}
		let missing=jobs[job].max-jobs[job].desired
		if(population-spent>=missing) jobs[job].desired+=missing,spent+=missing;
		else jobs[job].desired+=population-spent,spent=population;
	}
	// assign desired amount of surveyors ('none','one','all')
	// TODO convert "one" to suitable number for high population (insect)
	// for highpop=5 i think it's 8
	for(let job in jobs) if(jobs[job]=='hell_surveyor') {
		let num_survey=0;
		if(surveyors=='one') num_survey=1;
		else if(surveyors=='all') num_survey=jobs[job].max;
		if(num_survey==0) continue;
		if(population-spent>=num_survey) jobs[job].desired=num_survey;
		else jobs[job].desired=population-spent,spent=population;
	}
	// for some magic fraction of total workers, divide them equally among
	// basic jobs that aren't farmers and scavengers
	let tospend=Math.trunc(6+(population-6)*0.08);
	if(tospend>population-spent) tospend=population-spent;
	let num=0; // number of jobs to distribute among
	for(let job in jobs) {
		if(jobs[job].jobtype!='basic' || job=='unemployed' || job=='farmer' || job=='scavenger') continue;
		num++;
	}
	if(num>0) for(let job in jobs) {
		if(jobs[job].jobtype!='basic' || job=='unemployed' || job=='farmer' || job=='scavenger') continue;
		jobs[job].desired+=Math.trunc(tospend/num);
		spent+=Math.trunc(tospend/num);
	}
	// divide the rest of the workers among non-basic jobs, except priests and
	// tormentors
	num=0;     // number of eligible jobs
	let cap=0; // max number of slots to fill
	for(let job in jobs) {
		if(jobs[job].jobtype!='nonbasic' || job=='priest' || job=='torturer') continue;
		if((job=='miner' && !miners) || (job=='coal_miner' && !coalminers)) continue;
		if(jobs[job].max==-1) console.log('sanity error, uncapped specialist job');
		num++;
		cap+=jobs[job].max-jobs[job].desired;
	}
	if(num>0 && cap>0) {
		let fraction=(population-spent)/cap;
		if(fraction>1) fraction=1;
		// assign
		for(let job in jobs) {
			if(jobs[job].jobtype!='nonbasic' || job=='priest' || job=='torturer') continue;
			if((job=='miner' && !miners) || (job=='coal_miner' && !coalminers)) continue;
			spent+=Math.trunc(fraction*(jobs[job].max-jobs[job].desired));
			jobs[job].desired+=Math.trunc(fraction*(jobs[job].max-jobs[job].desired));
		}
	}
	// hire bankers, priests, tormentors in that order
	for(let job of ['banker','priest','torturer']) if(job in jobs) {
		if(population-spent<jobs[job].max-jobs[job].desired) {
			jobs[job].desired+=population-spent;
			spent=population;
		} else {
			spent+=jobs[job].max-jobs[job].desired;
			jobs[job].desired=jobs[job].max;
		}
	}
	// if scavengers exist, dump the rest there
	if('scavenger' in jobs) {
		job='scavenger';
		jobs[job].desired+=population-spent;
		spent=population;
	} else {
		// TODO otherwise, distribute evenly among non-farmer basic jobs
		let num=0;
		for(let job in jobs) {
			if(jobs[job].jobtype!='basic' || job=='unemployed' || job=='farmer') continue;
			num++;
		}
		let remain=Math.trunc((population-spent)/num);
		for(let job in jobs) {
			if(jobs[job].jobtype!='basic' || job=='unemployed' || job=='farmer') continue;
			if(jobs[job].max>=0) continue;
			jobs[job].desired+=remain;
			spent+=remain;
		}
		for(let job in jobs) {
			if(population==spent) break;
			if(jobs[job].jobtype!='basic' || job=='unemployed' || job=='farmer') continue;
			if(jobs[job].max>=0) continue;
			jobs[job].desired++;
			spent++;
		}
	}
	// if we have unspent population, dump the rest on farmers
	// (can happen with ent on non-trashed planet)
	if(population-spent>0 && 'farmer' in jobs) {
		console.log('dumped on farmers');
		jobs['farmer'].desired+=population-spent;
	}
	apply_population_changes(craft,jobs);
}

// return true if all worker slots in list are fully filled
function has_free_worker_slots(list) {
	for(let job of list) {
		let e=evolve.global.civic[job];
		if(e==undefined) continue;
		if(e.workers<e.max) return true;
	}
	return false;
}

// return total number of trade routes
function max_trade_routes() {
	return evolve.global.city.market.mtrade;
}

function num_active_trade_routes() {
	return evolve.global.city.market.trade;
}

// return current number of active trade routes of a given resource
function num_trade_routes(resource) {
	let q=document.getElementById('market-'+resource);
	if(q==null) return 0;
	// 'trade' changes position depending on whether we have manual trading
	q=getchildbyclassname(q,'trade');
	if(q==null) return null;
	return parseInt(q.childNodes[2].innerHTML);
}

function buy_trade_route(resource) {
	let q=document.getElementById('market-'+resource);
	if(q!=null) q.__vue__.autoBuy(resource);
}

function sell_trade_route(resource) {
	let q=document.getElementById('market-'+resource);
	if(q!=null) q.__vue__.autoSell(resource);
}

function cancel_trade_route(resource) {
	let q=document.getElementById('market-'+resource);
	if(q!=null) q.__vue__.zero(resource);
}

function cancel_all_trade_routes() {
	let q=document.getElementById('tradeTotal');
	if(q==null) return;
	q.__vue__.zero();
}

function use_all_trade_routes(sell,buy) {
	if(num_active_trade_routes()>0) return;
	let num=Math.trunc(max_trade_routes()/2);
	for(let i=0;i<num;i++) sell_trade_route(sell);
	for(let i=0;i<num;i++) buy_trade_route(buy);
}

// similar to set_trade_routes_percent, but uses number of trade routes
// instead of percentages
function set_trade_routes(list) {
	if(!Array.isArray(list)) { console.log('set_trade_percentages: expected list'); return false; }
	let res=['Food','Lumber','Chrysotile','Stone','Crystal','Furs','Copper','Iron','Aluminium','Cement','Coal','Oil','Uranium','Steel','Titanium','Alloy','Polymer','Iridium','Helium_3'];
	let current=[];
	let desired=[];
	let num=res.length;
	for(let i=0;i<num;i++) {
		current[i]=num_trade_routes(res[i]);
		desired[i]=0;
	}
	for(let i=0;i<list.length;i+=2) {
		let j=res.indexOf(list[i]);	
		if(j<0) { console.log('invalid trade id',list,list[i]); dfgdfs.length; return; }
		desired[j]=list[i+1];
	}
	// first pass: decrease
	let q=document.getElementById('market-qty').nextSibling;
	for(let i=0;i<num;i++,q=q.nextSibling) {
		if(current[i]>0 && desired[i]==0) q.__vue__.zero(res[i]),current[i]=0;
		if(current[i]>desired[i]) q.__vue__.autoSell(res[i],current[i]-desired[i]),current[i]=desired[i];
	}
	// second pass: increase
	q=document.getElementById('market-qty').nextSibling;
	for(let i=0;i<num;i++,q=q.nextSibling) {
		if(current[i]<0 && desired[i]==0) q.__vue__.zero(res[i]),current[i]=0;
		if(current[i]<desired[i]) q.__vue__.autoBuy(res[i],desired[i]-current[i]),current[i]=desired[i];
	}
}

// list is of the format [resource1, percent1, resource2, percent2 etc
// percent is the % of trade routes that go to its resource
// negative percentage means sell, positive means buy
// to make the routes entrepreneur-compatible, make sure half are sell routes
// example: ['Aluminium',-50,'Oil',25,'Uranium',25]
function set_trade_routes_percent(list) {
	if(!Array.isArray(list)) { console.log('set_trade_routes_percent: expected list, got',list); return false; }
	let total=max_trade_routes();
	let n=list.length;
	for(let i=1;i<n;i+=2) list[i]=Math.trunc(list[i]*total/100.0);
	set_trade_routes(list);
}

// do stuff unique for synth:
// build transmitters, assemble citizens
function synth_management() {
	if(!has_trait('powered')) return false;
	// if low on power, build power buildings
	if(evolve.global.city.power<0 && build_structure(['city-coal_power','city-oil_power'])) return true;
	else if(get_population()==get_max_population() && build_structure(['city-basic_housing','city-farm','city-cottage','city-lodge'])) return true;
	// build wireless transmitters if negative "food" production
	// TODO not tested, but i assume ravenous applies to synthetic
	// TODO don't build wireless transmitters if we don't have enough power for them
	// TODO build mines earler so we can build power producers faster
	if(get_ravenous_food_production()<0 && build_structure(['city-transmitter'])) return true;
	// assemble citizen
	if(get_population()!=get_max_population() && get_production('Food')>=0 && build_structure(['city-assembly'])) return true;
	return false;
}

function hooved_management() {
	if(!has_trait('hooved')) return false;
	// buy horseshoes up to 6 stored
	// TODO adjust for insect
	// i used scalar=2 here, but i lost the functionality
	if(evolve.global.resource.Horseshoe.amount<6 && build_structure(['city-horseshoe'])) return true;
	return false;
}

function slaver_management() {
	// don't bother with slave pens until slave market
	if(!has_trait('slaver') || !has_tech('slaves',2)) return false;
	if(evolve.global.resource.Slave.amount==evolve.global.resource.Slave.max) {
		if(build_structure(['city-slave_pen'])) return true;
		// TODO adjust slave price for truepath
	} else if(evolve.global.resource.Money.amount>25000+settings.slaver_buy_threshold) {
		// buy slave
		if(build_structure(['city-slave_market'])) return true;
	}
	return false;
}

// couldn't find a sensible way to get crate cost
function get_crate_cost_stupid(node) {
	let str=node.innerHTML;
	let pos=str.indexOf('costs ');
	let val=parseInt(str.slice(pos+6));
	let pos2=str.indexOf(' ',pos+8);
	let pos3=str.indexOf(' ',pos2+1);
	let res=str_capitalize(str.substring(pos2+1,pos3-1));
	if(res=='Amber') res='Stone';
	return [res,val];
}

function can_afford_crate(cost) {
	let amount=get_resource(cost[0])?.amount;
	if(amount==null) return false;
	return amount>=cost[1];
}

// build one crate
function build_crate() {
	let q=document.getElementById('createHead');
	let cost=get_crate_cost_stupid(q.childNodes[1].firstChild);
	if(can_afford_crate(cost)) {
		q.__vue__.crate();
		return true;
	}
	return false;
}

function build_container() {
	let q=document.getElementById('createHead');
	let cost=get_crate_cost_stupid(q.childNodes[2].firstChild);
	if(can_afford_crate(cost)) {
		q.__vue__.container();
		return true;
	}
	return false;
}

// crate management
// emulate governor task
// TODO this function is dumb and ends up querying the same DOM multiple times
function build_crates() {
	// emergency-build crates if we have low steel cap
	if(resource_exists('Crates') && resource_exists('Steel') && evolve.global.resource.Crates.max>0 && evolve.global.resource.Crates.amount==0 && evolve.global.resource.Steel.max<5000 && build_crate()) return true;
	let q=document.getElementById('createHead');
	if(resource_exists('Crates')) {
		let cost=get_crate_cost_stupid(q.childNodes[1].firstChild);
		// TODO change to while loop to speed up
		if(get_resource(cost[0])?.amount>settings.crate_reserve && evolve.global.resource.Crates.amount<evolve.global.resource.Crates.max && build_crate()) return true;
	}
	if(resource_exists('Containers') && resource_exists('Steel')) {
		let cost=get_crate_cost_stupid(q.childNodes[2].firstChild);
		// TODO change to while loop to speed up
		if(get_resource(cost[0])?.amount>settings.container_reserve && evolve.global.resource.Containers.amount<evolve.global.resource.Containers.max && build_container()) return true;
	}
	return false;
}

// return true if something was built
function build_storage_if_capped(list) {
	for(let id of list) {
		let minus=id.indexOf('-');
		if(minus==-1) console.log('probably error, called build_storage without minus with',id);
		let where=id.substring(0,minus);
		let what=id.slice(minus+1);
		let where2=sublocation.get(id);
		if(evolve.global[where][what]!=null && !can_afford_at_max(where,what,where2)) {
			// get bottleneck
			let bn=evolve.global[where][what].bn;
			// for some reason space buildings don't have bn defined
			// guess the likely bottleneck based on building
			if(bn==undefined) {
				if(['interstellar-mining_droid'].includes(id)) bn='Nano_Tube';
				else if(['interstellar-habitat','space-ziggurat'].includes(id)) bn='Money';
				else if(['space-iridium_mine'].includes(id)) bn='Titanium';
				else if(['space-exotic_lab'].includes(id)) bn='Elerium';
				else if(['interstellar-cruiser'].includes(id)) bn='Deuterium';
				else continue;
			}
			if(bn=='Money') {
				if(build_structure(['city-bank'])) return true;
				let low=can_afford_arpa('stock_exchange');
				if(low==100) return build_arpa_project('stock_exchange');
			} else if(['Steel','Titanium','Alloy'].includes(bn)) {
				if(build_structure(['city-storage_yard','city-warehouse','space-garage','interstellar-warehouse','interstellar-cargo_yard'])) return true;
			} else if(['Chrysotile','Stone','Clay','Copper','Iron','Furs','Crystal'].includes(bn)) {
				if(build_structure(['city-shed','interstellar-warehouse'])) return true;
			} else if(['Oil'].includes(bn)) {
				if(build_structure(['city-oil_depot','space-propellant_depot','space-gas_storage'])) return true;
			} else if(['Helium_3'].includes(bn)) {
				if(build_structure(['space-propellant_depot','space-gas_storage'])) return true;
			} else if(['Neutronium'].includes(bn)) {
				if(build_structure(['space-garage'])) return true;
			} else if(['Deuterium'].includes(bn)) {
				if(build_structure(['interstellar-nexus'])) return true;
			} else if(['Nano_Tube'].includes(bn)) {
				if(build_structure(['interstellar-warehouse','space-garage'])) return true;
			} else if(['Elerium'].includes(bn)) {
				// don't bother until we have depots in andromeda
			} else if(['Knowledge'].includes(bn)) {
				// can we afford supercollider fully, ignoring knowledge cost?
				let low=can_afford_arpa('lhc','Knowledge');
				let low2=can_afford_arpa('lhc');
				if(low==100 && low2>0) return build_arpa_project('lhc');
			}
		}
	}
	return false;
}

// WARNING!!!! the following code is prone to buy minor trait levels for phage
// if off-by-one bugs or weird stuff happens. make a save, etc, etc.
// buy genes given the priority list
// list is an array of n*2 elements [trait1, weight2, trait2, weight2 etc].
// higher weight means higher priority
// the function tries to buy the trait with the lowest current_genes - weight
// among all traits in the list
// tiebreaker if equal score: earlier position in priorities list
function arpa_genetics_buy_genes(priorities) {
	let traits=['content','ambidextrous','resilient','promiscuous','gambler','tactical','hardy','cunning','fibroblast','metallurgist','persuasive','industrious','analytical','mastery'];
	let current=[-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1];
	let weight=[];
	let bestweight=9999,bestindex=-1;
	for(let i=0;i<traits.length;i++) weight[i]=9999;
	// get current levels bought in this run
	// can't find them in global variables
	// but phage levels are in evolve.global.genes.minor
	let q=document.getElementById('geneticMinor');
	if(q==null) return;
	for(let i=0;i<q.childNodes.length;i++) {
		let z=q.childNodes[i].className.split(' ');
		let str=z[1].slice(2);
		let ix=traits.indexOf(str);
		if(ix<0) console.log('syntax error');
		current[ix]=parseInt(q.childNodes[i].childNodes[1].innerHTML.slice(7));
	}
	for(let i=0;i<priorities.length;i+=2) {
		let ix=traits.indexOf(priorities[i]);
		if(ix<0) { console.log('illegal arpa gene',priorities[i]); return; }
		weight[ix]=current[ix]-priorities[i+1];
		if(bestweight>weight[ix]) bestweight=weight[ix],bestindex=i;
	}
//console.log(priorities);
//console.log(traits);
//console.log(current);
//console.log(weight);
//console.log(bestweight,bestindex);
	for(let i=0;i<q.childNodes.length;i++) if(q.childNodes[i].className.indexOf('t-'+priorities[bestindex])>=0) {
		// try to buy
		let r=q.childNodes[i].childNodes[1];
		let s=r.className;
		// safety guard to avoid spending phage
		if(s.indexOf('pbuy')>=0) return;
		// another safety guard
		if(r.getAttribute('aria-label').indexOf('Phage')>=0) return;
		// check if we can afford priority trait. if we can't, don't bother with others
		if(s.indexOf('has-text-fade')>=0) return;
		r.click();
		break;
	}
}

// remove period or colon at the end if it exists
function arpacostconvert(str) {
	if(str.length==0) return str;
	if(str[str.length-1]=='.' || str[str.length-1]==':') return str.substring(0,str.length-1);
	return str;
}

// return how many segments we can afford of given arpa project
function can_afford_arpa(id,ignore=null) {
	let q=document.getElementById('arpa'+id);
	if(q==null) return null;
	// can we afford? we need to check manually.
	// can't use evolve.actions.arpa.id.cost.resource() because that's the raw cost
	// i ended up doing the pain of parsing the html, and this approach is
	// extremely sensitive to breaking by the smallest formatting change
	let str=q.childNodes[1].childNodes[1].getAttribute('aria-label');
	// we can't afford
	if(str.indexOf('Insufficient')>=0) return 0;
	let rawcosts=str.split(' ');
	let cost_res=[];
	let cost_amount=[];
	let numcost=0;
	for(let i=0;i<rawcosts.length;i++) {
		// find first resource name
		if(rawcosts[i]=='$') {
			// we found money
			cost_res[numcost]='Money';
			cost_amount[numcost++]=str_to_float(arpacostconvert(rawcosts[i+1]));
			i++;
		}
		let res=arpacostconvert(rawcosts[i]);
		if(res=='Clay') res='Stone';
//		else if
		if(resource_exists(res)) {
			cost_res[numcost]=res;
			cost_amount[numcost++]=str_to_float(arpacostconvert(rawcosts[i+2]));
			i+=2;
			continue;
		} else if(res=='Sheet') {
			res='Sheet_Metal';
			cost_res[numcost]=res;
			cost_amount[numcost++]=str_to_float(arpacostconvert(rawcosts[i+3]));
			i+=3;
		} else if(res=='Mud') {
			// "mud brick" is renamed brick for avian genus
			res='Brick';
			cost_res[numcost]=res;
			cost_amount[numcost++]=str_to_float(arpacostconvert(rawcosts[i+3]));
			i+=3;
		}
		// TODO check all possible costs and add more oddities
	}
	// check how many segments we can afford
	let low=100;
	for(let i=0;i<numcost;i++) {
		if(cost_res[i]==ignore) continue;
		let val=get_resource(cost_res[i]).amount;
		let num=Math.trunc(val/cost_amount[i]);
		if(num<1) return false; // can't afford 1%
		if(low>num) low=num;
	}
	return low;
}

// build the biggest chunk we can afford
// the vue action supports all steps from 1-100, not only those listed!
// arpa projects: lhc (supercollider), launch_facility, monument, railway,
// stock_exchange, nexus
// TODO find id for vacuum thingy
function build_arpa_project(id) {
	let low=can_afford_arpa(id);
	if(low==null || low==0) return false;
	let max=100-evolve.global.arpa[id].complete;
	if(low>max) low=max;
	let q=document.getElementById('arpa'+id);
	q.__vue__.build(id,low);
	return true;
}

// if we have a half-finished arpa project, prioritize it until it's finished
function finish_unfinished_arpa_project(){
	if(!tab_exists('arpa')) return false;
	let arpa=['lhc','launch_facility','monument','railway','stock_exchange','nexus'];
	for(let x of arpa) if(evolve.global.arpa.hasOwnProperty(x)) {
		if(evolve.global.arpa[x].complete>0 && evolve.global.arpa[x].complete<100) {
			build_arpa_project(x);
			return true;
		}
	}
	return false;
}

// rituals: army not used unless terrifying trait (balorg)
function pylon_management() {
	if(evolve.global.race.universe!='magic') return;
	let list=['science','miner','crafting','hunting'];
	if(resource_exists('Cement')) list.push('cement');
	if(resource_exists('Lumber')) list.push('lumberjack');
	if(has_trait('terrifying')) list.push('army');
	if(get_production('Mana')>4) {
		for(let res of list) increase_ritual(res);
	} else if(get_production('Mana')<1) {
		for(let res of list) decrease_ritual(res);
	}
}

function get_spy_cost(id) {
	let q=document.getElementById('foreign');
	let str=q.__vue__.spyDesc(id);
	let pos=str.indexOf('$');
	if(pos<0) return NaN;
	return str_to_float(str.slice(pos+1));
}

// spy manager:
// - does influence and sabotage
// - tries to purchase each foreign power
// - truepath 4th foreign power: influence until 100%
function spy_management() {
	// check if we can spy at all
	if(!has_tech('spy',2)) return false;
	if(has_tech('rival',1)) {
		// truepath rival power
		// i guess he doesn't exist until after unifying
		// numbered 3 (0-indexed)
		let q=document.getElementById('foreign');
		let spies=evolve.global.civic.foreign.gov3.spy;
		// buy up to 1 spy
		if(spies==0 && !q.__vue__.spy_disabled(3)) {
			let cost=get_spy_cost(3);
			if(get_resource('Money').amount>=cost+settings.spy_buy_threshold) {
				q.__vue__.spy(3);
				return true;
			}
		} else if(spies>=1 && evolve.global.civic.foreign.gov3.hstl>0) {
			// influence until 100%
			if(perform_spy_action(3,'influence')) return true;
		}
		return false;
	}
	// regular powers
	if(has_trait('unified')) return false;
	if(has_tech('unify',2)) return false;
	let q=document.getElementById('foreign');
	for(let i=0;i<3;i++) {
		// foreign power is gone
		let gov=evolve.global.civic.foreign['gov'+i];
		if(gov.anx || gov.buy || gov.occ) continue;
		// what is the point of r here? not used
		let r=document.getElementById('gov'+i).childNodes[2].childNodes[2].firstChild;
		let spies=gov.spy;
		// check if train spy button is enabled
		if(!q.__vue__.spy_disabled(i)) {
			// only buy up to 3 spies
			if(spies<3) {
				let cost=get_spy_cost(i);
				if(get_resource('Money').amount>=cost+settings.spy_buy_threshold) {
					q.__vue__.spy(i);
					return true;
				}
			}
		}
		// if we have 3 spies: purchase if we can afford
		if(spies==3) {
			// problem: we don't know the purchase cost until after we spawn the modal
			// just wing it somewhat. don't spawn the modal until we have money in the
			// expected ballpark (2.5M, 2M, 4.5M) and good money production
			// TODO might be different for truepath
			if(get_resource('Money').amount>settings.spy_purchase_power_thresholds[i]) {
				if(perform_spy_action(i,'purchase')) return true;
			}
		}
		// if we have 1 spy: always action
		// if we have >=2 spies: only do actions if relation is low
		if(spies==1 || (spies>=2 && (gov.hstl>40 || !q.__vue__.spy_disabled(i)))) {
			// influence if relations < 100 and not balorg
			if(gov.hstl>0 && !has_trait('terrifying')) {
				if(perform_spy_action(i,'influence')) return true;
			} else {
				// otherwise sabotage
				if(perform_spy_action(i,'sabotage')) return true;
			}
		}
	}
	return false;
}

// set tax as high as possible with morale >= max morale
// stay within given min,max
// tax will probably end up oscillating between 2 values, but i'm fine with it
function tax_morale_balance(min=20,max=55) {
	if(!evolve.global.civic.taxes.display) return;
	let q=document.getElementById('tax_rates');
	if(q==null) { console.log('taxes not found, shouldn\'t happen'); }
	let tax=evolve.global.civic.taxes.tax_rate,newtax=tax;
	let morale=evolve.global.city.morale.potential;
	let cap=evolve.global.city.morale.cap;
	if(morale>cap) newtax++;
	else newtax--;
	if(newtax<min) newtax=min;
	if(newtax>max) newtax=max;
	if(newtax>tax) q.__vue__.add();
	if(newtax<tax) q.__vue__.sub();
}

function get_matter_replicator_power() {
	if(!has_tech('replicator',1)) return;
	let q=document.getElementById('iReplicator');
	if(q==null) { console.log('error, matter replicator not found'); return; }
	return q.__vue__.pow;
}

// no parameter: adjust power, don't change replicated resource
function matter_replicator_management(resource=null) {
	if(!has_tech('replicator',1)) return;
	if(resource!=null && !resource_exists(resource)) return;
	let q=document.getElementById('iReplicator');
	if(q==null) { console.log('error, matter replicator not found'); return; }
	if(resource!=null && q.__vue__.res!=resource && q.__vue__.avail(resource)) q.__vue__.setVal(resource);
	let current=evolve.global.city.power;
	if(current<settings.replicator_power_buffer-1) {
		while(current<settings.replicator_power_buffer-1) q.__vue__.less(),current++;
	} else if(current>settings.replicator_power_buffer+1) {
		while(current>settings.replicator_power_buffer+1) q.__vue__.more(),current--;
	}
}

// unicorn shrines
// build 25 knowledge shrines, then metal shrines
function build_shrine() {
	if(!has_trait('magnificent')) return false;
	if(!building_exists('city','shrine')) return false;
	let moon=evolve.global.city.calendar.moon;
	let bonus='';
	if(moon%7==0) bonus='cycle';
	else if(moon<7) bonus='morale';
	else if(moon<14) bonus='metal';
	else if(moon<21) bonus='knowledge';
	else bonus='tax';
	if(get_building('city','shrine').know<25 && bonus=='knowledge') return build_structure(['city-shrine']);
	else if(get_building('city','shrine').know>=25 && bonus=='metal') return build_structure(['city-shrine']);
	return false;
}

//-----------------------
// code for MAD territory
//-----------------------

// techs that only terrified trait (balorg) researches in MAD runs
const MAD_balorg_techs=new Set(['armor','mercs','zealotry','espionage','spy']);
// techs that all races avoid in MAD runs
const MAD_avoidlist=new Set(['theocracy','steel_vault','socialist','corpocracy','reinforced_crates','barns','gantry_crane','zoning_permits','assembly_line','kroll_process','casino','gmfood','massive_trades','polymer','alloy_drills','bunk_beds','genetics','stock_market','monuments','uranium_ash','robotics',
'dial_it_to_11','limit_collider']);
// if any of these are capped, build storage
const MAD_capped_list=new Set(['city-garrison','city-smelter','city-oil_well','city-metal_refinery','city-basic_housing','city-farm','city-lodge','city-cottage','city-apartment','city-bank','city-pylon']);

function MAD_research_tech() {
	let avoidlist=MAD_avoidlist.union(tech_avoid_safeguard);
	if(!has_trait('terrifying')) avoidlist=avoidlist.union(MAD_balorg_techs);
	return research_tech(avoidlist);
}

// set smelters to 5 iron, the rest steel. if <10 total, distribute equally
function MAD_set_smelter_output() {
	if(!resource_exists('Steel')) return; // we don't have steel, return
	let smelter=get_building('city','smelter');
	if(smelter!=null) {
		let max=smelter.cap;
		let iron,steel;
		if(max<10) steel=Math.trunc(max/2),iron=max-steel;
		else iron=5,steel=max-5;
		set_smelter_output(iron,steel,0);
	}
}

// TODO fix this later
// right now the script doesn't even buy more nanite factories
function MAD_set_nanite_input() {
	if(has_trait('deconstructor')) set_nanite_input('Stone',50*get_building('city','nanite_factory').count);
}

function MAD_change_government(from,to) {
	if(from!=null && evolve.global.civic.govern.type!=from) return false;
	if(evolve.global.civic.govern.type==to) return false;
	return change_government(to);
}

function MAD_build_basic_structures() {
	return build_structure(['city-basic_housing','city-farm','city-lodge','city-lumber_yard','city-rock_quarry']);
}

// TODO adjust for insects
function MAD_low_population() {
	let lowpop=10;
	if(get_max_population()<lowpop) {
		if(MAD_build_basic_structures()) return true;
		// build horseshoes if needed for initial population
		if(has_trait('hooved') && get_population()+evolve.global.resource.Horseshoe.amount<10) {
			return build_structure(['city-horseshoe']);
		}
		return true; // don't continue script until we have 10 population
	}
	return false;
}

function MAD_vital_buildings(vital) {
	let missing=false;
	for(let building of vital) if(evolve.global.city.hasOwnProperty(building) && evolve.global.city[building].count==0) {
		// try building one of them
		if(build_structure(['city-'+building])) return true;
		// if we can't build: just skip
		let timeleft=production_time_left('city',building);
		missing=true;
		if(timeleft==NaN) {
			console.log('script stuck on freight yard');
			// special case for freight yard when we can't craft every element
			if(building=='storage_yard' && evolve.global.city.foundry.count<num_crafting_materials()) {
				if(build_structure(['city-foundry'])) return true;
			}
			// time left forever, just skip
			console.log('no production for',building);
			continue;
		}
		// speed up copper if it's slow
		if(evolve.global.city[building].bn=='Copper' && timeleft>60 && build_structure(['city-mine'])) return true;
		// do we have enough storage?
		if(can_afford_at_max('city',building)) continue;
		// not enough storage: buy more
		// if we couldn't afford it: determine the bottleneck, and build
		// suitable storage building
		if(evolve.global.city[building].bn=='Money' && build_structure(['city-bank'])) return true;
		else if(build_structure(['city-shed'])) return true;
	}
	// if none of the missing buildings could be built, abort script and try
	// to build these later
	return missing;
}

// buy extra cement plants because the normal function doesn't.
// usually happens when script waits a long time to buy an oil derrick with
// only 1 cement plant
function MAD_cement() {
	if(!resource_exists('Cement') || !resource_exists('Titanium')) return false;
	return get_building('city','cement_plant').count<5 && build_structure(['city-cement_plant']);
}

function MAD_knowledge_buildings() {
	let need_knowledge=-1;
	let q=document.getElementById('tech-rocketry');
	if(q) need_knowledge=q.firstChild.getAttribute('data-knowledge');
	q=document.getElementById('tech-mad');
	if(q) {
		let cost=q.firstChild.getAttribute('data-knowledge');
		if(need_knowledge<cost) need_knowledge=cost;
	}
	if(need_knowledge<0) need_knowledge=120000;
	if(evolve.global.resource.Knowledge.max<need_knowledge) {
		if(build_structure(['city-university','city-library'])) return true;
		if(evolve.global.city.powered && evolve.global.city.power>0 || evolve.global.resource.Knowledge.max<50000) {
			if(build_structure(['city-wardenclyffe'])) return true;
			// don't buy biolabs before we have uranium storage
			if(has_tech('uranium',2) && build_structure(['city-biolab'])) return true;
		}
	}
	return false;
}

function MAD_spammable_buildings() {
	if(has_tech('agriculture',6)) {
		// turn on all windmills and build new ones
		let onoff=get_enabled_disabled('city-mill');
		if(onoff!=null && onoff[1]>0) enable_building('city-mill');
		if(build_structure(['city-mill'])) return true;
	}
	return build_structure(['city-windmill','city-temple','city-garrison','city-lumber_yard','city-smelter','city-metal_refinery','city-amphitheatre','city-trade','city-oil_well','city-bank','city-captive_housing','city-graveyard','city-soul_well','city-smokehouse','city-pylon']);
}

function MAD_spammable_housing() {
	// don't build if we have unborn citizens
	if(get_population()<get_max_population()) return false;
	// don't build if synth. synth builds in its own function
	if(has_trait('powered')) return false;
	return build_structure(['city-basic_housing','city-farm','city-lodge','city-cottage']);
}

function MAD_worker_buildings() {
	if(!has_free_worker_slots(['miner','cement_worker','craftsman'])) {
		if(build_structure(['city-foundry','city-mine','city-cement_plant'])) return true;
		// stop at around 15 coal mines i guess
		if(num_structures('city-coal_mine')<15 && build_structure(['city-coal_mine'])) return true;
	}
	return false;
}

function MAD_power_buildings() {
	if(evolve.global.city.powered) {
		if(evolve.global.city.power<=0) {
			if(build_structure(['city-coal_power','city-oil_power'])) return true;
		}
		return false;
	}
}

function MAD_spammable_buildings_that_use_power() {
	// synth wants to wait a bit with factories
	if(has_trait('powered')) {
		if(has_tech('uranium',1) && build_structure(['city-factory'])) return true;
	} else {
		// research hunter process before building factories
		if(has_tech('titanium',1) && build_structure(['city-factory'])) return true;
	}
	if(evolve.global.city.power>=0) {
		if(build_structure(['city-rock_quarry','city-sawmill'])) return true;
	}
	// don't build apartments if we have unborn citizens as synth
	if(has_trait('powered') && get_max_population()-get_population()>0) return false;
	if(evolve.global.city.power>=0 && build_structure(['city-apartment'])) return true;
	return false;
}

function pylon_management() {
	if(evolve.global.race.universe!='magic') return;
	let list=['science','miner','crafting','hunting'];
	if(resource_exists('Cement')) list.push('cement');
	if(resource_exists('Lumber')) list.push('lumberjack');
	if(has_trait('terrifying')) list.push('war');
	if(get_production('Mana')>4) {
		for(let res of list) increase_ritual(res);
	} else if(get_production('Mana')<1) {
		for(let res of list) decrease_ritual(res);
	}
}

function MAD_trade() {
	if(has_trait('terrifying')) return; // no trading for balorg
	if(resource_exists('Titanium') && !has_tech('titanium',1)) {
		// we have discovered titanium, but don't have hunter process:
		// trade for titanium
		
	}
	
}

// TODO the trade logic is a mess
// unify into a single function, and also trade for oil
// if we have researched industrialism but not hunter process:
// trade for titanium
function MAD_trade_titanium() {
	if(has_trait('terrifying')) return;
	if(resource_exists('Titanium')) {
		if(!has_tech('titanium',1)) {
			if(get_resource('Titanium').amount>8000) {
				// we have enough titanium, cancel trade routes
				cancel_all_trade_routes();
			} else if(num_trade_routes('Titanium')==0) {
				// buy for 33% of total income
				let diff=get_production('Money');
				let price=evolve.tradeBuyPrice('Titanium');
				let amount=Math.trunc(diff*0.333/price);
				if(amount*2>max_trade_routes()) amount=Math.trunc(max_trade_routes()/2);
				set_trade_routes(['Stone',-amount,'Titanium',amount]);
			}
			// if we lose money, remove some trade routes
			if(get_production('Money')<0 && num_trade_routes('Titanium')>0) {
				buy_trade_route('Stone');
				sell_trade_route('Titanium');
			}
		} else {
			// we have hunter process, cancel titanium trade routes
			if(num_trade_routes('Titanium')>0) {
				cancel_all_trade_routes();
			}
		}
	}
}

// if we have a factory but haven't researched uranium storage:
// trade for alloy
function MAD_trade_alloy() {
	if(has_trait('terrifying')) return;
	if(!resource_exists('Alloy')) return;
	if(!has_tech('uranium',2) && get_building('city','factory').count>=1) {
		if(num_trade_routes('Alloy')==0) {
			// buy for 33% of total income
			let diff=get_production('Money');
			let price=evolve.tradeBuyPrice('Alloy');
			let amount=Math.trunc(diff*0.333/price);
			if(amount*2>max_trade_routes()) amount=Math.trunc(max_trade_routes()/2);
			set_trade_routes(['Stone',-amount,'Alloy',amount]);
		}
	} else if(has_tech('uranium',2) && num_trade_routes('Alloy')!=0) cancel_all_trade_routes();
}

// if we have uranium storage but not mad: trade for uranium and oil
function MAD_trade_uranium() {
	if(has_trait('terrifying')) return;
	if(has_tech('uranium',2) && !has_tech('mad',1)) {
		// we're probably rich by now
		if(num_trade_routes('Uranium')==0) set_trade_routes_percent(['Aluminium',-50,'Uranium',25,'Oil',25]);
		// if we lose money, remove some trade routes
		if(get_production('Money')<0 && num_trade_routes('Uranium')>0) {
			buy_trade_route('Aluminium');
			sell_trade_route('Uranium');
		}
	}
	if(has_tech('mad',1) && num_trade_routes('Uranium')>0) cancel_all_trade_routes();
}

function MAD_balorg() {
	if(!has_trait('terrifying')) return false;
	if(build_structure(['city-hospital','city-boot_camp'])) return true;
	// fight for resources, only when we have full army
	if(evolve.global.civic.garrison.workers==evolve.global.civic.garrison.max && evolve.global.civic.garrison.wounded==0) {
		// TODO see if i can do this with more vue actions and less DOM stuff
		let q=document.getElementById('c_battalion');
		if(q!=null) {
			// add all soldiers to battalion
			let num=q.childNodes[2].innerHTML;
			while(num<evolve.global.civic.garrison.max) {
				q.childNodes[3].click();
				num++;
			}
			// change campaign type to assault, seems to be the most efficient one
			// (we don't want to siege and occupy)
			let r=document.getElementById('c_tactics');
			if(r!=null) {
				let str=r.childNodes[2].innerHTML;
				if(str=='Ambush') {
					r.childNodes[3].click();r.childNodes[3].click();r.childNodes[3].click();
				} else if(str=='Raid') {
					r.childNodes[3].click();r.childNodes[3].click();
				} else if(str=='Pillage') {
					r.childNodes[3].click();
				} else if(str=='Siege') {
					r.childNodes[1].click();
				}
			}
			// attack the first power that's alive
			for(let i=0;i<3;i++) {
				let gov=evolve.global.civic.foreign['gov'+i];
				if(gov.anx || gov.buy || gov.occ) continue;
				let s=document.getElementById('gov'+i);
				if(s!=null) s.childNodes[2].firstChild.click()
			}
		}
	}
	return false;
}

function MAD_zen() {
	// build meditation chambers only if zen power is full
	if(evolve.global.resource.hasOwnProperty('Zen') && evolve.global.resource.Zen.amount==evolve.global.resource.Zen.max) {
		if(build_structure(['city-meditation'])) return true;
	}
	return false;
}

// synth stuff specific for mad territory
function MAD_synth_management() {
	if(!has_trait('powered')) return false;
	// synth wants to have some cement plants. power is a struggle, so turn them off
	if(num_structures('city-cement_plant')<5 && build_structure(['city-cement_plant'])) return true;
	let onoff=get_enabled_disabled('city-cement_plant');
	if(onoff!=null && onoff[0]>0) disable_building('city-cement_plant');
	// very low aluminium production: mitigate with trade routes
	// these routes are entrepreneur-legal
	if(!has_trait('terrifying')) {
		if(get_production('Aluminium')<2) {
			sell_trade_route('Stone');
			buy_trade_route('Aluminium');
		} else if(get_production('Aluminium')>20 && (num_trade_routes('Aluminium')!=0 || num_trade_routes('Stone')!=0)) {
			cancel_trade_route('Aluminium');
			cancel_trade_route('Stone');
		}
		if(get_production('Oil')<2) {
			sell_trade_route('Stone');
			buy_trade_route('Oil');
		} else if(get_production('Oil')>20 && (num_trade_routes('Oil')!=0 || num_trade_routes('Stone')!=0)) {
			cancel_trade_route('Oil');
			cancel_trade_route('Stone');
		}
	}
	return false;
}

function MAD_main(governor) {
	if(handle_modals()) return;
	gather_all(); // script is allowed to continue
	if(spy_management()) return;
	if(MAD_research_tech()) return;
	MAD_set_smelter_output();
	MAD_set_nanite_input();
	tax_morale_balance(20,55);
	matter_replicator_management('Brick');
	if(set_governor(governor)) return;
	if(MAD_change_government('anarchy','democracy')) return;
	// if we somehow research federation before MAD
	if(has_tech('gov_fed',1) && MAD_change_government(null,'federation')) return;
	if(set_governor_task('bal_storage')) return;
	// build one rock quarry asap to make quarry worker job available
	if(evolve.global.city?.rock_quarry?.count===0 && build_structure(['city-rock_quarry'])) return;
	// build one mine asap to start copper production, needed early if we have horseshoes
	if(evolve.global.city?.mine?.count===0 && build_structure(['city-mine'])) return;
	// build one farm asap to unlock farmers
	if(evolve.global.city?.farm?.count===0 && build_structure(['city-farm'])) return;
	assign_population('eq',true,true);
	// assign servants equally. could be smarter, but whatever
	if(get_max_population()>0 && evolve.global.race.hasOwnProperty('servants')) assign_jobs_equally(document.getElementById('servants'),evolve.global.race.servants.max);
	// assign skilled servants equally
	if(get_max_population()>0 && evolve.global.race.hasOwnProperty('servants')) assign_jobs_equally(document.getElementById('skilledServants'),evolve.global.race.servants.smax);
	// do synth stuff if we're synth
	if(synth_management()) return;
	if(MAD_synth_management()) return;
	// if we have less than 10 population, build housing and basic job structures
	if(MAD_low_population()) return;
	// zen
	if(MAD_zen()) return;
	// set mimic
	if(has_trait('shapeshifter') && get_mimic()=='none' && set_mimic(['heat','avian','plant','small'])) return;
	// fungi: buy compost heap if food production is negative
	if(get_ravenous_food_production()<0 && build_structure(['city-compost'])) return;
	// unstable planets: build more mines if negative iron production because of crafters
	if(get_production('Iron')<0 && build_structure(['city-mine','city-basic_housing','city-farm','city-lodge'])) return;
	// mostly for synth: build metal refineries if aluminium deficit
	if(get_production('Aluminium')<0 && build_structure(['city-metal_refinery'])) return;
	// emergency-build coal mines if coal deficit
	if(get_production('Coal')<0 && build_structure(['city-coal_mine'])) return;
	// buy horseshoes up to 6 if we're hooved
	if(hooved_management()) return;
	if(MAD_cement()) return;
	// halt here until we've built vital buildings
	if(MAD_vital_buildings(['bank','garrison','silo','shed','cement_plant','foundry','mine','coal_mine','smelter','storage_yard','trade','oil_well','oil_depot','mill','graveyard','soul_well','farm','pylon','lodge'])) return;
	// build knowledge buildings
	if(MAD_knowledge_buildings()) return;
	if(build_shrine()) return;
	// spam buildings that don't use power or add new jobs
	if(MAD_spammable_buildings()) return;
	// spam basic housing unless we're synth
	if(MAD_spammable_housing()) return;
	// build buildings that create jobs, but not if we have unfilled important
	// worker slots like cement workers and crafters
	if(MAD_worker_buildings()) return;
	// build power if deficit
	if(MAD_power_buildings()) return;
	// spam buildings that require power if we have power surplus
	if(MAD_spammable_buildings_that_use_power()) return;
	// in magic: pylon management
	pylon_management();
	// slaver
	if(slaver_management()) return;
	// build storage for capped buildings
	if(build_storage_if_capped(MAD_capped_list)) return;
	// trade for titanium, trade routes are entrepreneur-friendly
	MAD_trade_titanium();
	MAD_trade_alloy();
	// TODO trade for steel
	// trade for uranium, oil
	MAD_trade_uranium();
	// TODO balorg
	if(MAD_balorg()) return;
	// build crates
	if(build_crates()) return;
}

function MAD_bot() {
	MAD_main('educator');
//	MAD_main('noble'); // if we want more plasmids
}

//----------------------------------------------------------------------
// code for bioseed territory
// also includes earth after researching MAD before launching into space
//----------------------------------------------------------------------

// techs that all races avoid in bioseed runs
const bioseed_avoidlist=new Set(['long_range_probes']);
// if any of these are capped, build storage
const bioseed_capped_list=new Set(['city-tourist_center','space-satellite','space-sun_mission','space-gas_moon_mission','space-gas_mining','space-outpost','space-living_quarters','space-ziggurat']);

function bioseed_build_2_monuments() {
	if(!tab_exists('arpa')) return false;
	if(!evolve.global.arpa.hasOwnProperty('monument')) return false;
	if(evolve.global.arpa.monument.rank<2) {
		// cancel old trade routes from mad territory
		// we didn't get a chance to do it in the mad code before being thrown here
		if(num_active_trade_routes()>0) cancel_all_trade_routes();
		// buy the biggest chunk we can afford
		if(build_arpa_project('monument')) return true;
	}
	if(get_building_count('space','station')>0 && evolve.arpa.lhc.rank<1) {
		// build 1 supercollider
		if(build_arpa_project('lhc')) return true;
	}
	return false;
}

function bioseed_build_launch_facility() {
	// wait until we have tourism i guess
	if(!has_tech('monument',2)) return false;
	// if we have tourism we are guaranteed to have arpa
	return evolve.global.arpa.launch_facility.rank<1 && build_arpa_project('launch_facility');
}

function bioseed_factory_management() {
	// number of factories
	// TODO include space factories
	let num=get_num_factory_production_lines();
	if(!resource_exists('Nano_Tube')) {
		// if we don't have polymer, or if launch facility is under production:
		// set all factories to alloy
		if(!resource_exists('Polymer') || (tab_exists('arpa') && evolve.global.arpa.hasOwnProperty('launch_facility') && evolve.global.arpa.launch_facility.complete>0 && evolve.global.arpa.launch_facility.complete<100)) {
			set_factory_production(['Alloy',num]);
		} else {
			// early parts of bioseed: 50/50 between alloy and polymer
			let polymer=Math.trunc(num/2);
			let alloy=num-polymer;
			set_factory_production(['Alloy',alloy,'Polymer',polymer]);
		}
	} else if(resource_exists('Nano_Tube') && num>=7 && (evolve.global.starDock?.seeder==undefined || evolve.global.starDock.seeder.count<100)) {
		// nanotubes + please have at least 10 factories. even that is very low
		// as much as we can on nanotubes, the rest 50/50 between alloy and polymer
		let nano=get_factory_production('Nano');
		if(nano==0) nano=Math.trunc(get_production('Coal')/20);
		else if(get_production('Coal')<0) nano--;
		else if(get_production('Coal')>20) nano++;
		let numleft=num-nano;
		if(numleft<6) { nano-=6-numleft; numleft=6; }
		let polymer=Math.trunc(numleft/2)
		let alloy=numleft-polymer;
		set_factory_production(['Alloy',alloy,'Polymer',polymer,'Nano',nano]);
	} else if(evolve.global.starDock?.seeder?.count==100) {
		// we've built bioseeder ship, no more nanotubes
		let polymer=Math.trunc(num/2)
		let alloy=num-polymer;
		set_factory_production(['Alloy',alloy,'Polymer',polymer]);
	}
}

function earth_buildings_we_always_want() {
	// population
	if(build_structure(['city-basic_housing','city-cottage','city-farm','city-lodge'])) return true;
	if(evolve.global.city.power>0 && build_structure(['city-apartment'])) return true;
	// army
	if(build_structure(['city-garrison'])) return true;
	// power generation
	if(build_structure(['city-mill','city-windmill','city-coal_power','city-oil_power','city-fission_power','space-geothermal'])) return true;
	// knowledge
	if(build_structure(['city-university','city-library'])) return true;
	if(evolve.global.city.power>0 && build_structure(['city-wardenclyffe','city-biolab'])) return true;
	// production
	if(build_structure(['city-smelter','city-metal_refinery','city-pylon'])) return true;	
	if(evolve.global.city.power>0 && build_structure(['city-rock_quarry','city-factory','space-gas_mining','space-red_factory','space-outpost'])) return true;
	// money
	if(build_structure(['city-bank','city-storage_yard'])) return true;
	// make an exception for carnivore, hard to get actual food production
	if((get_ravenous_food_production()>50 || has_trait('carnivore')) && build_structure(['city-tourist_center'])) return true;
	// trade
	if(build_structure(['city-storage_yard','city-trade','city-wharf'])) return true;
	// build job buildings only if we have no unfilled important jobs
	if(!has_free_worker_slots(['miner','cement_worker','craftsman'])) {
		if(evolve.global.city.power>0) {
			if(build_structure(['city-foundry','city-mine','city-cement_plant','city-casino','space-spc_casino'])) return true;
			// stop at around 15 coal mines i guess
			if(num_structures('city-coal_mine')<15 && build_structure(['city-coal_mine'])) return true;
		}
		if(build_structure(['city-temple','city-amphitheatre'])) return true;
	}
	if(evolve.global.race.universe=='magic' && can_afford_arpa('nexus')==100 && build_arpa_project('nexus')) return true;
	return false;
}

// can't have enough of these buildings
function bioseed_buildings_we_always_want() {
	// bottlenecks
	if(evolve.global.arpa.launch_facility.rank==1 && !building_exists('space','satellite') && build_structure(['space-test_launch'])) return true;
	if(get_building_count('space','moon_base')<1 && build_structure(['space-moon_mission','space-moon_base'])) return true;
	if(build_one(['space-iridium_mine','space-helium_mine','space-propellant_depot'])) return true;
	if(get_building_count('space','spaceport')<1 && build_structure(['space-red_mission'])) return true;
	if(build_one(['space-spaceport','space-living_quarters','space-garage','space-red_mine','space-fabrication','space-biodome','space-red_factory','space-space_barracks'])) return true;
	if(get_building_count('space','geothermal')<1 && build_structure(['space-hell_mission'])) return true;
	if(build_one(['space-geothermal'])) return true;
	if(get_building_count('space','gas_mining')<1 && build_structure(['space-gas_mission'])) return true;
	if(build_one(['space-gas_mining','space-gas_storage','space-swarm_control','space-swarm_satellite','space-outpost','space-oil_extractor','space-space_station','space-iron_ship','space-elerium_ship'])) return true;
	if(get_building_count('space','swarm_control')<1 && build_structure(['space-sun_mission'])) return true;
	if(get_building_count('space','outpost')<1 && build_structure(['space-gas_moon_mission'])) return true;
	if(get_building_count('space','space_station')<1 && build_structure(['space-belt_mission'])) return true;
	if(get_building_count('space','elerium_ship')>=1 && evolve.global.arpa.lhc.rank==0 && build_arpa_project('lhc')) return true;
	if(build_structure(['space-dwarf_mission'])) return true;
	// population
	if(build_structure(['city-basic_housing','city-cottage','city-farm','city-lodge'])) return true;
	if(evolve.global.city.power>0 && build_structure(['city-apartment'])) return true;
	// army
	if(build_structure(['city-garrison'])) return true;
	// power generation
	if(build_structure(['city-mill','city-windmill','city-coal_power','city-oil_power','city-fission_power','space-geothermal'])) return true;
	// knowledge
	if(build_structure(['city-university','city-library'])) return true;
	if(build_structure(['space-satellite'])) return true;
	if(evolve.global.city.power>0 && build_structure(['city-wardenclyffe','city-biolab'])) return true;
	// production
	if(build_structure(['city-smelter','city-metal_refinery','city-pylon'])) return true;	
	if(evolve.global.city.power>0 && build_structure(['city-rock_quarry','city-factory','space-gas_mining','space-red_factory','space-outpost'])) return true;
	// money
	if(build_structure(['city-bank','city-storage_yard'])) return true;
	// make an exception for carnivore, hard to get actual food production
	if((get_ravenous_food_production()>50 || has_trait('carnivore')) && build_structure(['city-tourist_center'])) return true;
	// trade
	if(build_structure(['city-storage_yard','city-trade','city-wharf'])) return true;
	// build job buildings only if we have no unfilled important jobs
	if(!has_free_worker_slots(['miner','cement_worker','craftsman'])) {
		if(evolve.global.city.power>0) {
			if(build_structure(['city-foundry','city-mine','city-cement_plant','city-casino','space-spc_casino'])) return true;
			// stop at around 15 coal mines i guess
			if(num_structures('city-coal_mine')<15 && build_structure(['city-coal_mine'])) return true;
		}
		if(build_structure(['city-temple','city-amphitheatre'])) return true;
	}
	// production bonus
	if(build_structure(['space-ziggurat'])) return true;
	// mana
	if(evolve.global.race.universe=='magic' && can_afford_arpa('nexus')==100 && build_arpa_project('nexus')) return true;
	// build a second supercollider when we can finish it in its entirety
	if(evolve.global.arpa.lhc.rank<2 && can_afford_arpa('lhc')==100 && build_arpa_project('lhc')) return true;
	// buy gps satellites. titanium is precious, but trading is good
	// at least that doesn't slow down space probes
	if(!has_trait('terrifying') && build_structure(['space-gps'])) return true;
	if(!has_trait('terrifying') && can_afford_arpa('railway')==100 && build_arpa_project('railway')) return true;
	return false;
}

function bioseed_manage_population() {
	assign_population('eq',true,true);
	// assign servants equally. could be smarter, but whatever
	if(get_max_population()>0 && evolve.global.race.hasOwnProperty('servants')) assign_jobs_equally(document.getElementById('servants'),evolve.global.race.servants.max);
	// assign skilled servants equally
	if(get_max_population()>0 && evolve.global.race.hasOwnProperty('servants')) assign_jobs_equally(document.getElementById('skilledServants'),evolve.global.race.servants.smax);
}

// assemble a gene when we're at max knowledge
function bioseed_sequence_genes_manually() {
	// de_novo_sequencing required
	// routine is redundant after rapid gene sequencing
	if(has_tech('genetics',6) && !has_tech('genetics',8)) {
		let q=document.getElementById('arpaSequence');
		if(q==null) return false;
		if(evolve.global.resource.Knowledge.amount==evolve.global.resource.Knowledge.max && evolve.global.resource.Knowledge.max>=200000) {
			// click assemble gene
			q.__vue__.novo();
			return true;
		}
	}
	return false;
}

function bioseed_buy_minor_traits() {
	// can't do this until i've unlocked genetic sequencing
	let list=[];
	// priorities when in bioseed-land
	// more or less determined on a whim
	list.push('mastery'); list.push(5);
	// ignore hardy if cement doesn't exist
	if(resource_exists('Cement')) list.push('hardy'),list.push(5);
	list.push('analytical'); list.push(5);
	if(!has_trait('terrifying')) list.push('persuasive'); list.push(5);
	if(has_trait('terrifying')) {
		list.push('tactical'); list.push(6);
		list.push('fibroblast'); list.push(4);
	}
	list.push('content'); list.push(4);
	list.push('ambidextrous'); list.push(4);
	list.push('metallurgist'); list.push(4);
	list.push('cunning'); list.push(3);
	list.push('industrious'); list.push(3);
	list.push('promiscuous'); list.push(2);
	list.push('gambler'); list.push(2);
	list.push('resilient'); list.push(1);
	arpa_genetics_buy_genes(list);
}

function bioseed_trade_route_management() {
	// we have satellites but not rovers. also assume we need titanium
	if(!has_tech('space_explore',2) && building_exists('space','satellite') && !resource_exists('Iridium')) set_trade_routes_percent(['Aluminium',-50,'Alloy',30,'Titanium',20]);
	else if(resource_exists('Iridium') && has_tech('space_explore',2) && !has_tech('space_explore',3) && num_trade_routes('Iridium')==0) {
		// we have iridium, but no trade routes on iridium
		set_trade_routes_percent(['Aluminium',-50,'Iridium',45,'Titanium',5]);
	// TODO set some trade routes to helium-3 when we have moon base, helium-3 mine but not space probes
	} else if(has_tech('space_explore',3) && (!building_exists('space','gas_mining') || get_building_count('space','gas_mining')<5)) {
		// we have space probes, we have fewer than helium-3 collectors
		set_trade_routes_percent(['Aluminium',-50,'Iridium','22','Helium_3',22,'Titanium',6]);
	} else if(get_building_count('space','gas_mining')>=5) {
		// we have at least 5 helium-3 collectors and we're still buying helium-3
		// change to a bit of uranium and full iridium instead
		let num2=Math.trunc(max_trade_routes()/2);
		set_trade_routes(['Aluminium',-num2-1,'Uranium',15,'Titanium',15,'Iridium',num2-30]);
	}
}

function bioseed_set_smelter_output() {
	if(!has_tech('irid_smelting',1)) MAD_set_smelter_output();
	else {
		// still don't boost iridium in bioseed-land
		MAD_set_smelter_output();
	}
}

function bioseed_build_on_moon() {
	if(!building_exists('space','moon_base') || !building_exists('space','nav_beacon')) return false;	
	let max=evolve.global.space.moon_base.s_max;
	let cur=evolve.global.space.moon_base.support;
	if(cur>=max) return build_structure(['space-nav_beacon','space-moon_base']);
	// don't need helium-3 mines, helium-3 collectors are much better
	return build_structure(['space-observatory','space-iridium_mine']);
}

function bioseed_build_on_red_planet(){
	if(!building_exists('space','spaceport') || !building_exists('space','red_tower')) return false;
	let max=evolve.global.space.spaceport.s_max;
	let cur=evolve.global.space.spaceport.support;
	if(cur>=max) return build_structure(['space-spaceport','space-red_tower']);
	list=['space-exotic_lab','space-living_quarters','space-red_mine','space-biodome'];
	// don't build fabrications until we have subspace beacons in interstellar-land
	// also don't build fabrications when we are saving up wrought iron for embassy
	if(has_tech('luna',3)) list.push('space-fabrication'),list.push('space-nav_beacon');
	return build_structure(list);
}

function bioseed_build_on_sun() {
	// extremely low priority. for now, don't build at all
	return false;
}

function bioseed_build_on_belt() {
	if(!building_exists('space','space_station') || !building_exists('space','elerium_ship')) return false;
	// build up to 4 elerium ships in bioseed land
	// if we go the world collider route, let interstellar_main build more
	if(get_building_count('space','elerium_ship')>=4) return false;
	let max=evolve.global.space.space_station.s_max;
	let cur=evolve.global.space.space_station.support;
	// max-1 because elerium ships use 2 support
	if(cur>=max-1) return build_structure(['space-space_station']);
	return build_structure(['space-elerium_ship']);;
}

// see line 13483 in volch for multisegment stuff
// see line 1317 in volch for arpa projects

// does bioseed stuff up to researching genesis ship
// important: this function must return true/false as it it called by main2
function bioseed_main() {
	if(handle_modals()) return true;
	MAD_set_nanite_input();
	bioseed_manage_population();
	bioseed_set_smelter_output();
	tax_morale_balance(20,55);
	if(spy_management()) return true;
	if(research_tech(bioseed_avoidlist.union(tech_avoid_safeguard))) return true;
	pylon_management();
	if(synth_management()) return true;
	if(slaver_management()) return true;
	bioseed_factory_management();
	// bioseeder ship is finished, prep ship is done, we are only allowed to build:
	// more factories (to build space probes faster)
	// earth housing
	// earth power sources
	if(has_tech('genesis',7)) {
		// TODO set matter replicator to the bottleneck element of space probes
		// there should be only space probes in the queue
		if(evolve.global.queue.queue.length>0 && evolve.global.queue.queue[0].type=='probes') {
			let q=evolve.global.queue.queue[0];
			if(['Polymer','Alloy','Iridium','Chrysotile'].includes(q.bres)) matter_replicator_management(q.bres);
			else matter_replicator_management();
		}
		if(build_structure(['city-factory','space-red_factory'])) return true;
		if(build_structure(['city-basic_housing','city-cottage','city-farm','city-apartment','city-lodge'])) return true;
		if(build_structure(['city-mill','city-windmill','city-coal_power','city-oil_power','city-fission_power'])) return true;
		return;
	}
	matter_replicator_management('Brick');
	if(bioseed_build_2_monuments()) return true;
	// TODO do spy stuff, aim to purchase all foreign powers
	// build most buildings
	if(bioseed_buildings_we_always_want()) return true;
	if(build_shrine()) return;
	if(bioseed_build_launch_facility()) return true;
	bioseed_trade_route_management();
	// these planets need support
	if(bioseed_build_on_moon()) return true;
	if(bioseed_build_on_red_planet()) return true;
	if(bioseed_build_on_sun()) return true;
	if(bioseed_build_on_belt()) return true;
	if(has_tech('gov_fed',1) && MAD_change_government(null,'federation')) return;
	// todo change government from federation to corpocracy (or whatever had the
	// factory bonus) after researching nanotubes (but only if we stop at bioseed)

	// sequence genes manually whenever we can
	// we want this low in the list so we don't sabotage researching techs
	if(bioseed_sequence_genes_manually()) return true;
	bioseed_buy_minor_traits();
	// TODO consider removing terrible genes like hooved

	// build storage for capped buildings
	if(build_storage_if_capped(MAD_capped_list.union(bioseed_capped_list))) return true;

	// build crates. this one takes ages, have it at the bottom
	if(build_crates()) return true;

	return false;
}

function bioseed_spacedock() {
	if(global.bioseed_action!='') return false;
	if(get_building_count('space','star_dock')==0 && build_structure(['space-star_dock'])) return true;
	else if(get_building_count('space','star_dock')==1 && evolve.global.starDock.seeder.count==0) {
		if(is_spacedock_modal_open()) return false;
		// if we tried to build space probes or the bioseeder ship,
		// at least one of these is true: queue is non-empty, and we finished some
		// stuff
		if(!is_build_queue_empty() || evolve.global.starDock.probes.count>0 && evolve.global.starDock.seeder>0) return false;
		let q=document.getElementById('space-star_dock');
		if(q==null) return false;
		// in modal, queue bioseeder ship and fill queue with space probes
		global.bioseed_action='ship_and_probes';
		q.__vue__.trigModal();
		return true;
	} else if(evolve.global.starDock.seeder.count==100) {
		// factories set to produce 0 nanotubes elsewhere in the code
		// prep ship is genesis,7
		if(has_tech('genesis',7)) return false;
		if(is_spacedock_modal_open()) return false;
		// buy prep ship
		global.bioseed_action='prep_ship';
		let q=document.getElementById('space-star_dock');
		if(q==null) return false;
		q.__vue__.trigModal();
		return true;
	}
	return false;
}

// bioseed part 2: build bioseeder ship, prep ship (but don't launch ship)
// also builds space probes until user launches ship
function bioseed_main2() {
	if(handle_modals()) return true;
	tax_morale_balance(20,55);
	if(bioseed_spacedock()) return;
	if(bioseed_main()) return;
}

function bioseed_bot() {
	if(!has_tech('mad',1)) MAD_main('entrepreneur');
	else if(bioseed_main()) return;
	else if(has_tech('genesis',3) && has_tech('high_tech',11)) bioseed_main2();
}

//--------------------------------
// code for interstellar territory
//--------------------------------

// techs that are avoided in interstellar
const interstellar_avoidlist=new Set(['combat_droids']);
const interstellar_capped_list=new Set(['interstellar-habitat','interstellar-mining_droid','interstellar-processing','interstellar-g_factory','city-wardenclyffe','city-biolab','space-satellite','space-observatory','interstellar-far_reach']);

// some kind of weighting system for crafters
// the weight of a crafting resource depends on the following:
// - low cost => higher priority
// - more important building => higher priority
// => priority = low_cost * importance
// all crafters are set to the most important resource
// if we have matter replicator we never focus on aerogel and nanoweave
// extremely important buildings that cost a lot of a crafting resource gets
// cranked up. examples:
// - embassy in andromeda (we set it to important a long time before unlocking it)
// - forward base in truepath
// - ascension megaprojects
// buildings in interstellar that are moderately important:
// - nexus stations when helix nebula support is full
// - mythril when building stellar engine
// - wardenclyffe when not capped on knowledge
function interstellar_crafter_priority() {
}

// same principle as above
// most likely targets for replicating: bolognium, vitreloy, aerogel,
// nanoweave, orichalcum, scarletite
function interstellar_replicator_priority() {
}

function interstellar_replicator_management() {
	// before infernite: replicate bricks i guess
	if(!resource_exists('Infernite')) matter_replicator_management('Brick');
	else if(evolve.global.portal.fortress.patrols==0) {
		// infernite discovered, but no patrols in hell yet: infernite
		matter_replicator_management('Infernite');
	} else {
		// we have patrols in hell: use priority to determine resource
		matter_replicator_management();
	}
	return false;
}

// TODO would be beneficial to speed this up. currently builds one at a time
// though we can abuse a weakness in the script by holding multiplier keys
function build_world_collider() {
	if(evolve.global.space.world_collider.count==1859) return false;
	return build_structure(['space-world_collider']);
}

function interstellar_factory_management() {
	let num=get_num_factory_production_lines();
	if(evolve.global.space.world_collider.count<1859) {
		// world collider not done, set factories to mostly alloy and a bit of the
		// rest
		let polymer=4,nanotubes=4;
		let alloy=num-polymer-nanotubes;
		set_factory_production(['Alloy',alloy,'Polymer',polymer,'Nano',nanotubes]);
		return;
	}
	// distribute furs,alloy,polymer,nanotubes,stanene 1,2,2,2,2
	let furs=0,alloy=0,polymer=0,nanotubes=0,stanene=0;
	let has_stanene=has_tech('stanene',1);
	let sum=0;
	for(let i=0;sum<num;i++) {
		if(i%2==1) furs++,sum++;
		if(sum<num) alloy++,sum++;
		if(sum<num) polymer++,sum++;
		if(sum<num) nanotubes++,sum++;
		if(sum<num && has_stanene) stanene++,sum++;
	}
	list=['Furs',furs,'Alloy',alloy,'Polymer',polymer,'Nano',nanotubes];
	if(has_stanene) list.push('Stanene'),list.push(stanene);
	set_factory_production(list);
}

function interstellar_buildings_we_always_want() {
	// bottlenecks
	if(!building_exists('interstellar','starport') && build_structure(['interstellar-alpha_mission'])) return true;
	if(!building_exists('interstellar','xfer_station') && build_structure(['interstellar-proxima_mission'])) return true;
	if(!building_exists('interstellar','nexus') && build_structure(['interstellar-nebula_mission'])) return true;
	if(!building_exists('interstellar','neutron_miner') && build_structure(['interstellar-neutron_mission'])) return true;
	if(!building_exists('interstellar','farpoint') && build_structure(['interstellar-blackhole_mission'])) return true;
	if(building_exists('interstellar','xfer_station') && get_building('interstellar','xfer_station').count==0 && build_structure(['interstellar-xfer_station'])) return true;
	if(building_exists('interstellar','nexus') && get_building('interstellar','nexus').count==0 && build_structure(['interstellar-nexus'])) return true;
	if(building_exists('portal','carport') && get_building('portal','carport').count==0 && build_structure(['portal-carport'])) return true;
	// loose buildings in solar system that don't need support
	if(build_structure(['space-satellite'])) return true;
	if(build_structure(['space-ziggurat','space-red_factory'])) return true;
	if(build_structure(['space-geothermal','space-spc_casino','space-gas_mining','space-outpost','space-e_reactor'])) return true;
	// TODO don't build marine garrisons and oil extractors when building embassy
	if(build_structure(['space-space_barracks','space-oil_extractor'])) return true;
	// improve healing and training before sending soldiers to hell
	if(build_structure(['city-hospital','city-boot_camp'])) return true;
	if(build_structure(['interstellar-cruiser','interstellar-far_reach'])) return true;
	return false;
}

function interstellar_build_on_belt() {
	// build only iron ships?
	// not sure if i should buy iridium ships also
	// unpopulated space miner jobs decrease max, use count instead
	let max=evolve.global.space.space_station.count*3;
	let cur=evolve.global.space.space_station.support;
	if(cur>=max) return build_structure(['space-space_station']);
	return build_structure(['space-iron_ship']);;
}

function interstellar_build_on_alpha_centauri() {
	if(!building_exists('interstellar','starport')) return false;
	if(building_exists('interstellar','habitat') && build_structure(['interstellar-habitat'])) return true;
	let max=evolve.global.interstellar.starport.s_max;
	let cur=evolve.global.interstellar.starport.support;
	if(cur>=max) {
		list=['interstellar-starport'];
		// TODO don't build when building embassy
		if(building_exists('interstellar','xfer_station')) list.push('interstellar','xfer_station');
		return build_structure(list);
	}
	return build_structure(['interstellar-mining_droid','interstellar-processing','interstellar-g_factory','interstellar-fusion']);
}

function interstellar_build_on_helix_nebula() {
	// before stellar engine
	let max=evolve.global.interstellar.nexus.s_max;
	let cur=evolve.global.interstellar.nexus.support;
	if(cur>=max) {
		if(max==6) return false;
		return build_structure(['interstellar-nexus']);
	}
	if(max<=6) {
		if(building_exists('interstellar','elerium_prospector') && get_building('interstellar','elerium_prospector').count<1 && build_structure(['interstellar-elerium_prospector'])) return true;
		if(building_exists('interstellar','harvester') && get_building('interstellar','harvester').count<5 && build_structure(['interstellar-harvester'])) return true;
		return false;
	} else return build_structure(['interstellar-elerium_prospector']);
	return false;
}

function mining_droid_management() {
	if(!building_exists('interstellar','mining_droid')) return;
	let num=evolve.global.interstellar.mining_droid.count;
	// all in adamantite for the first 5
	if(num<=5) set_mining_droid_production(['adam',num]);
	// number 6 and 7 in uranium and coal. at 7 we depopulate coal miners
	if(num==6) set_mining_droid_production(['adam',num-1,'uran',1]);
	// into adamantite again until 11
	if(num<=11) set_mining_droid_production(['adam',num-2,'uran',1,'coal',1]);
	if(num>=12 && num<1000) {
		// baseline: 10 adamantite, 1 coal, 1 uranium
		let left=num-12;
		let adam=10,uran=1,coal=1,alum=0;
		// leftovers: 30% coal, 30% adam, 40% alum
		adam+=Math.trunc(left*0.3); left-=Math.trunc(left*0.3);
		coal+=Math.trunc(left*0.3); left-=Math.trunc(left*0.3);
		alum+=Math.trunc(left*0.4); left-=Math.trunc(left*0.4);
		alum+=left;
		set_mining_droid_production(['adam',adam,'uran',uran,'coal',coal,'alum',alum]);	}
}

function interstellar_manage_population() {
	// depopulate coal miners if mining droid produces both uranium and coal
	let need_coal_miners=true;
	if(building_exists('interstellar','mining_droid') && evolve.global.interstellar.mining_droid.coal>0 && evolve.global.interstellar.mining_droid.uran>0) need_coal_miners=false;
	let surveyor='none';
	// 1 surveyor if sports governor and we have a carport and we haven't started hell
	// if we have soldiers, max surveyors
	if(building_exists('portal','carport') && get_building('portal','carport').count>=1) {
		if(evolve.global.portal.fortress.patrols>0) surveyor='all';
		else if(evolve.global.race.governor?.g?.bg=='sports') surveyor='one';
	}
	// depopulate miners if we have good iron production in asteroid belt
	// (at least 15 iron ships i guess)
	let need_miners=true;
	if(get_building('space','iron_ship').count>=15) {
		need_miners=false;
		// turn off power to mines
		onoff=get_enabled_disabled('city-mine');
		while(onoff[0]>0) disable_building('city-mine'),onoff[0]--;
	}
	// TODO focus crafters now
	assign_population('eq',need_miners,need_coal_miners,surveyor);
	// assign servants equally. could be smarter, but whatever
	if(get_max_population()>0 && evolve.global.race.hasOwnProperty('servants')) assign_jobs_equally(document.getElementById('servants'),evolve.global.race.servants.max);
	// assign skilled servants equally
	if(get_max_population()>0 && evolve.global.race.hasOwnProperty('servants')) assign_jobs_equally(document.getElementById('skilledServants'),evolve.global.race.servants.smax);
}

function interstellar_buy_minor_traits() {
	// can't do this until i've unlocked genetic sequencing
	let list=[];
	// priorities when in interstellar-land
	// higher number => more desired
	// more or less determined on a whim
	list.push('mastery'); list.push(5);
	// ignore hardy if cement doesn't exist
	if(resource_exists('Cement')) list.push('hardy'),list.push(5);
	list.push('tactical'); list.push(5);
	list.push('fibroblast'); list.push(4);
	list.push('analytical'); list.push(1);
	if(!has_trait('terrifying')) list.push('persuasive'); list.push(4);
	list.push('content'); list.push(4);
	list.push('ambidextrous'); list.push(5);
	list.push('metallurgist'); list.push(4);
	list.push('cunning'); list.push(3);
	list.push('promiscuous'); list.push(3);
	list.push('gambler'); list.push(2);
	arpa_genetics_buy_genes(list);
}

function interstellar_main(reset_type) {
	if(handle_modals()) return true;
	MAD_set_nanite_input();
	interstellar_manage_population();
	pylon_management();
	interstellar_replicator_management();
	interstellar_buy_minor_traits();
	if(synth_management()) return true;
	if(slaver_management()) return true;
	tax_morale_balance(20,55);
	interstellar_factory_management();
	mining_droid_management();
	// arpa project in progress: finish it before anything else
	if(finish_unfinished_arpa_project()) true;
	// change to theocracy when ziggurat bonus > 350%
	// can't easily find it, so just change when we have infernite
	if(resource_exists('Infernite') && MAD_change_government(null,'theocracy')) return true;
	// build world collider
	if(build_world_collider()) return true;
	if(build_shrine()) return true;
	matter_replicator_management();
	if(bioseed_build_on_red_planet()) return true;
	if(bioseed_build_on_moon()) return true;
	if(interstellar_buildings_we_always_want()) return true;
	if(earth_buildings_we_always_want()) return true;
	if(research_tech(interstellar_avoidlist.union(tech_avoid_safeguard))) return true;
	if(interstellar_build_on_alpha_centauri()) return true;
	if(interstellar_build_on_helix_nebula()) return true;
	if(interstellar_build_on_belt()) return true;
	// build storage for capped buildings
	if(build_storage_if_capped(MAD_capped_list.union(bioseed_capped_list).union(interstellar_capped_list))) return true;



	// build up production of elerium, neutronium



// set smelter to 5 iron, 5 iridium, the rest steel
// build supercolliders whenever we can afford everything except knowledge
// build monuments whenever we can afford fully

// interstellar: build mining droids, processing facilities, graphene plants.
// in hell: build 1 carport surveyor to unlock infernite, set replicator to
// infernite. if sports, set 1 worker to infernite (he's immortal)

// on earth: build almost everything that increases population and production:
// all population buildings, banks, tourist centers, amphitheaters, casinos,
// all knowledge buildings, all military buildings, trade posts,
// quarries, cement plants, foundries, factories, smelters, metal refineries,
// all power buildings
// build earth storage only on demand

// in asteroid belt: build iron mining ships

// factories: we need all of aluminium, polymer, nanotubes, stanene. just
// distribute them equally?

// mining droid: set 1 to coal, 1 to uranium very early, depopulate all
// coal miners, turn off power
// whenever we have graphene and stanene, set crate management to:
// 3x aluminium, 2x polymer, 3x graphene, 3x stanene

// crafting: probably biggest need for bricks

// after researching patrol cruisers, set matter replicator to aerogel.
// if no replicator, set all crafters to aerogel for a while
// after subspace beacons, build fabrications freely

// during interstellar, build all power sources

// black hole reset: don't spend soul gems except for virtual reality tech
// run that goes to andromeda: research hellfire furnace, quantum entanglement,
// build 1 citadel station. don't research combat droids. 

// we want like 300 MW or more before building wormhole. build dyson net first

	// build crates. this one takes ages, have it at the bottom
	if(build_crates()) return true;

	return false;
}

function blackhole_bot() {
	if(!has_tech('mad',1)) MAD_main('sports');
	else if(!has_tech('genesis',3) || !has_tech('high_tech',11)) bioseed_main();
	else interstellar_main('blackhole');
}

/////////////////////////////////
// ascend (farm harmony crystals)
/////////////////////////////////

// when in andromeda, set all crafters on wrought iron and save all of it for
// embassy 
// soul forge: don't buy gun emplacements since they cost wrought iron (never
// buy them anyway i guess). or just ignore soul forge entirely i guess, it
// has poor soul gem production and its main use is to get a corrupted soul gem

//////////////////////
// pillar, then ascend
//////////////////////

function andromeda_main() {
}

function pillar_bot() {
	if(!has_tech('mad',1)) MAD_main('sports');
	else if(!has_tech('genesis',3) || !has_tech('high_tech',11)) bioseed_main();
	else if(1==1) interstellar_main('ascension');
	else andromeda_main();
}

//--------------------------
// code for edenic territory
//--------------------------

// elysium fields, celestial fortress
// this part sucks combined with a high number of attractor beacons
// where we can barely sustain peacekeepers
// i guess we just turn off attractor beacons and autohire mercs
// and then keep bashing at the fortress
// order:
// - ambush patrol down to 18 for tech
// - raid supplies down to 99% readiness for another tech
// - ambush patrol down to 15 + raid supplies down to 80% for another tech
// - then 0 patrols -> 0% readiness -> whack fortress
// * build lots of asphodel bunkers, they are locked behind one of the above
//   techs (forgot which). should triple our soldier training speed or so
// * desperately buy boot camps and temples (zealotry) during this
// * arpa->genetics->tactical should already be as high as we can get it
// turn on attractor beacons, turn off autohire mercs when done
// during the above sction, don't spend soul gems. we want to save up for the
// upcoming 5000 soul gems

//---------------------------------
// code for ai apocalypse territory
//---------------------------------

// very bottleneck-heavy, optimize around it
// - sheet metal for forward base
// - mass relay
// - charge up mass relay
// - send fastest corvettes to eris, enough to scan
// - send big ships to kuiper and triton to have non-shitty production

//----------
// launchers
//----------

// TODO when i can be bothered to make ui stuff, make a selection screen

// comment out the desired type of run

//setInterval(MAD_bot, 1000);
//setInterval(bioseed_bot, 1000);
setInterval(blackhole_bot, 1000);
//setInterval(pillar_bot, 1000);
//setInterval(ascend_bot, 1000);
//setInterval(demonic_infusion_bot, 1000);
//setInterval(apotheosis_bot, 1000);
//setInterval(matrix_bot, 1000);
//setInterval(retirement_bot, 1000);
//setInterval(lone_survivor_bot, 1000);
//setInterval(warlord_bot, 1000);
//setInterval(truepath_orbital_decay_kamikaze_bot,1000);
