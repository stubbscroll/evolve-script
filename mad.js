// script to automate MAD runs only. doesn't automate protoplasm phase, doesn't
// perform the reset.
// i made this because i was bored of doing 0* setup runs
// truepath mad not supported (script won't attempt to get 50 steel, or occupy
// foreign powers and unify. might eventually research mutual destruction if
// we get enough steel from ancient caches and we fanaticism'd unified)

// requirements:
// - evolve v1.4.8
// - turn on debug mode in game->settings
// - turn on preload tab content in game->settings
// - english locale i guess, since script compares text in some cases
//   (governor tasks)

// progression requirements:
// - governors unlocked (otherwise the player must manually assign crates to
//   steel, titanium, alloy etc)
// - start with 25 steel from technophobe (otherwise the player must trade or
//   raid for steel manually)
// * supports servants and skilled servants

// how to use:
// - do the evolution stuff, choose genus, set challenge genes (optionally),
//   pick a race, start the run
// - press f12 to open javascript console (in firefox and chrome at least, dunno
//   about other browsers)
// - copy/paste the contents of this file into the console and press enter

// not yet implemented:
// - set all crafters to sheet metal after researching it
// - buy unicorn shrines for knowledge cap
// - care about evil universe and authority

// current bugs:
// - resources->market and resources->storage: shows garbage at bottom. seems to
//   happen in most runs. no idea why

// current very suboptimal behaviour (could be because of bugs)
// - todo

var change_government=''; // global variable to store the government we want to
                          // change to across subsequent calls (because of modal)

// techs that aren't researched in a mad run
// first list: combat techs that only balorg takes
const MADavoidcombattechs=new Set([
	'tech-armor',	     // leather armor
	'tech-mercs',      // mercenaries
	'tech-zealotry',   // zealotry
	'tech-espionage',  // espionage
	'tech-spy',        // spies
]);
// bigger list of techs that aren't researched
const MADavoidtechs=new Set([
	'tech-theocracy',  // theocracy
	'tech-steel_vault',// steel vault
	'tech-republic',   // republic
	'tech-socialist',  // socialist
	'tech-corpocracy', // corpocracy
	'tech-federation', // federation
	'tech-reinforced_crates',  // reinforced crates
	'tech-barns',              // barns
	'tech-gantry_crane',       // gantry cranes
	'tech-zoning_permits',     // zoning permits (script never queues)
	'tech-assembly_line',      // assembly line
	'tech-kroll_process',      // kroll process
	'tech-casino',             // casino
	'tech-gmfood',             // gm food
	'tech-massive_trades',     // massive volume trading
	'tech-polymer',            // polymer
	'tech-alloy_drills',       // alloy drills
	'tech-bunk_beds',          // bunk beds (we don't care about MAD plasmids)
	'tech-genetics',           // genetics
	'tech-stock_market',       // stock exchange
	'tech-monuments',          // monuments
	'tech-uranium_ash',        // uranium ash
	'tech-robotics',           // advanced robotics
	// just in case we activate this script by accident in non-mad runs,
	// don't research the techs below
	'tech-demonic_infusion',
	'tech-purify_essence',
	'tech-protocol66',
	// TODO cataclysm techs, the 2 black hole techs, long-range probes,
	// the ascension one that costs 25 phage, bomb demon lord
]);

// return production per second of a given resource
// TODO get this in a sane format
function get_production(resource) {
	let fq=document.getElementById('res'+resource);
	if(fq==null) return 0;
	return fq.childNodes[2].innerHTML;
}

// distribute workers equally among all jobs in subcategory
// (only used for servants and skilled servants, technically compatible
// with crafters as long as there's no scarletite or quantium)
// parameters:
// - joblist: pointer into job list parent in DOM
// - max: max number of workers
// TODO this breaks when called from assign_population
function assign_jobs_equally(joblist,max) {
	if(joblist==0) return; // not found in DOM, abort
	let n=joblist.childNodes.length; // number of entries in job list
	if(n==0) return;       // no child nodes, abort
	let active=0;                    // number of active jobs
	let amount=[n];                  // currently assigned workers to job i
	let visible=[n];                 // true=visible
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
	for(let i=1,k=0;i<n;i++) if(visible[i]) {
		let desired=Math.trunc(max/active);
		let q=joblist.childNodes[i];
		q.childNodes[1].childNodes[1].click();
	}
}

// eq=true: distribute crafters equally
// eq=false: all crafters on one material
// TODO handle later stuff like space miners, colonists, titan colonists
// TODO handle ship crew and other jobs that can't be assigned from civics
// TODO this function is a hideous mess, clean up if it becomes unmaintainable
function assign_population(eq) {
	let q=document.getElementById('jobs'); // can this be empty? ent and mimic avian on non-trashed planet?
	let r=document.getElementById('foundry'); // might be empty
	// evolve.global.civic contains jobs
	// for example evolve.global.civic.unemployed.workers
	let jobs={};
	let qn=q.childNodes.length,rn=(r!=null?r.childNodes.length:r=0);
	for(let i=0;i<qn;i++) { // start at 0 since there's no header
		let cur=q.childNodes[i];
		if(cur.hasAttribute('style') && cur.getAttribute('style')!='') continue;
		let jobname=cur.id.substring(4);
		let jobtype;
		let value=cur.firstChild.childNodes[1].innerHTML;
		let slash=value.indexOf('/'),max=-1,current=-1,desired=0;
		if(slash==-1) {
			jobtype='basic'; // aka non-crafter job with no max limit
			current=parseInt(value);
		} else {
			jobtype='nonbasic';
			current=parseInt(value.substring(0,slash));
			max=parseInt(value.substring(slash+1));
		}
		jobs[jobname]={jobtype,current,desired,max};
	}
	// add crafters to list
	for(let i=1;i<rn;i++) { // start at 1 since there is a header
		let cur=r.childNodes[i];
		if(cur.hasAttribute('style') && cur.getAttribute('style')!='') continue;
		let jobname=cur.firstChild.id;
		let jobtype;
		let value=cur.firstChild.childNodes[1].innerHTML;
		let slash=value.indexOf('/'),max=-1,current=-1,desired=0;
		if(slash==-1) {
			jobtype='crafter'; // basic unbounded crafter job
			current=parseInt(value);
			desired=0;
		} else {
			jobtype='limitcrafter'; // special capped crafter job (scarletite, quantium)
			current=parseInt(value.substring(0,slash));
			max=parseInt(value.substring(slash+1));
			desired=0;
		} 
		jobs[jobname]={jobtype,current,desired,max};
	}
	// adjust the number of farmers depending on storage and production
	// TODO make this work when there are no farmers and other jobs (raiders) give food
	// TODO handle the case where the script tries to assign more population than
	//      we have. could theoretically happen if we still have a food deficit
	//      with the entire population as farmers
	let spent=0; // number of workers assigned
	let population=evolve.global.resource[evolve.global.race.species].amount;
	// TODO fix this, doesn't currently work
	if('farmer' in jobs) {
		jobs['farmer'].desired=jobs['farmer'].current;
		if(get_production('Food').substring(0,1)=='-') {
			// food deficit: add 1 more farmer
			jobs['farmer'].desired++;
		} else if(evolve.global.resource.Food.amount==evolve.global.resource.Food.max) {
			jobs['farmer'].desired--;
			if(jobs['farmer'].desired<0) jobs['farmer'].desired=0;
		}
		spent=jobs['farmer'].desired;
	}
	// assign 1 to each job except scavenger, tormentor, priest, crafting
	for(job in jobs) {
		if('farmer' in jobs && spent==population && jobs['farmer'].desired>1) {
			// even if we starve, we really want to produce a little bit of each thing
			jobs['farmer'].desired--; spent--;
		}
		if(job=='unemployed' || job=='farmer' || job=='scavenger' || job=='priest' || jobs[job].jobtype=='crafter' || jobs[job].jobtype=='limitcrafter') continue;
		if(jobs[job].desired==0 && jobs[job].max!=0) {
			jobs[job].desired=1;
			spent++;
		}
	}
	// TODO max out vital jobs, like colonists
	// for some magic fraction of total workers, divide them equally among
	// basic jobs that aren't farmers and scavengers
	let tospend=Math.trunc(6+(population-6)*0.08);
	if(tospend>population-spent) tospend=population-spent;
	let num=0; // number of jobs to distribute among
	for(job in jobs) {
		if(jobs[job].jobtype!='basic' || job=='unemployed' || job=='farmer' || job=='scavenger') continue;
		num++;
	}
	if(num>0) for(job in jobs) {
		if(jobs[job].jobtype!='basic' || job=='unemployed' || job=='farmer' || job=='scavenger') continue;
		jobs[job].desired+=Math.trunc(tospend/num);
		spent+=Math.trunc(tospend/num);
	}
	// assign crafters. max them out
	// the following code clicks instead of assigns in a data structure,
	// which is inconsistent and can break horribly
	if(eq && evolve.global.civic.craftsman.max>0) {
		// spread them equally
		let active=evolve.global.civic.craftsman.max;
		if(active>population-spent) active=population-spent;
		assign_jobs_equally(r,active);
		spent+=active;
	} else {
		// TODO all crafters in the same slot
	}
	// TODO adjust the number of entertainers, remove if authority isn't maxed
	// divide the rest of the workers among non-basic jobs, except priests and
	// tormentors
	num=0;     // number of eligible jobs
	let cap=0; // max number of slots to fill
	for(job in jobs) {
		if(jobs[job].jobtype!='nonbasic' || job=='priest' || job=='tormentor') continue;
		if(jobs[job].max==-1) console.log('sanity error, uncapped specialist job');
		num++;
		cap+=jobs[job].max-jobs[job].desired;
	}
	if(num>0 && cap>0) {
		let fraction=(population-spent)/cap;
		if(fraction>1) fraction=1;
		// assign
		for(job in jobs) {
			if(jobs[job].jobtype!='nonbasic' || job=='priest' || job=='tormentor') continue;
			spent+=Math.trunc(fraction*(jobs[job].max-jobs[job].desired));
			jobs[job].desired+=Math.trunc(fraction*(jobs[job].max-jobs[job].desired));
		}
	}
	// hire bankers, priests,  tormentors in that order
	for(job of ['banker','priest','tormentor']) if(job in jobs) {
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
		for(job in jobs) {
			if(jobs[job].jobtype!='basic' || job=='unemployed' || job=='farmer') continue;
			num++;
		}
		let remain=Math.trunc((population-spent)/num);
		for(job in jobs) {
			if(jobs[job].jobtype!='basic' || job=='unemployed' || job=='farmer') continue;
			jobs[job].desired+=remain;
			spent++;
		}
		for(job in jobs) {
			if(population==spent) break;
			if(jobs[job].jobtype!='basic' || job=='unemployed' || job=='farmer') continue;
			jobs[job].desired++;
			spent++;
		}
	}
	// perform the distribution. loop once to remove, then loop again to add
	// (should work independently of what the default job is)
	for(let i=0;i<qn;i++) {
		let cur=q.childNodes[i];
		if(cur.hasAttribute('style') && cur.getAttribute('style')!='') continue;
		let job=cur.id.substring(4);
		// skip default job
		let cur2=cur.childNodes[1];
		if(cur2.hasAttribute('style') && cur2.getAttribute('style')!='') continue;
		// remove workers
		while(jobs[job].desired<jobs[job].current) {
			cur2.firstChild.click();
			jobs[job].current--;
		}
	}
	for(let i=0;i<qn;i++) {
		let cur=q.childNodes[i];
		if(cur.hasAttribute('style') && cur.getAttribute('style')!='') continue;
		let job=cur.id.substring(4);
		// skip default job
		let cur2=cur.childNodes[1];
		if(cur2.hasAttribute('style') && cur2.getAttribute('style')!='') continue;
		// add workers
		while(jobs[job].desired>jobs[job].current) {
			cur2.childNodes[1].click();
			jobs[job].current++;
		}
	}
}

// return true if any of the given buildings are capped
function city_iscapped(list) {
	for(building of list) if(evolve.global.city.hasOwnProperty(building)) {
		let q=document.getElementById('city-'+building);
		if(q!=null && q.className=='action cna cnam vb') return true;
	}
	return false;
}

// attempt to build one of the buildings given by the array
// only builds in the first tab (city), generalize function later
// return true if we built something
function build_city(list) {
	for(building of list) if(evolve.global.city.hasOwnProperty(building)) {
		let q=document.getElementById('city-'+building);
		if(q!=null && q.className=='action vb') {
			q.__vue__.action();
			return true;
		}
	}
	return false;
}

// check if any jobs in given list are not maxed out, return true if yes
function free_worker_slots(list) {
	for(job of list) {
		let e=evolve.global.civic[job];
		if(e==undefined) continue;
		if(e.workers<e.max) return true;
	}
	return false;
}

function getchildbyclassname(q,str) {
	for(let i=0;i<q.childNodes.length;i++) if(q.childNodes[i].className==str) {
		return q.childNodes[i];
	}
	return null;
}

// return current number of active trade routes of a given resource
function num_traderoutes(resource) {
	let q=document.getElementById('market-'+resource);
	if(q==null) return 0;
	// 'trade' changes position depending on whether we have manual trading
	q=getchildbyclassname(q,'trade');
	if(q==null) return null;
	return q.childNodes[2].innerHTML;
}

function build_crate() {
	let q=document.getElementById('createHead');
	q.childNodes[1].childNodes[1].firstChild.click();
}

function MAD_bot() {
	let race=evolve.global.race;
	// spawned modals from previous call must be handled before everything else
	// if we spawned change government modal, change government now
	{
		let q=document.getElementById('govModal');
		if(q!=null && evolve.global.civic.govern.type!=change_government) {
			for(let i=0;i<q.childNodes.length;i++) {
				if(q.childNodes[i].getAttribute('data-gov')==change_government) {
					q.childNodes[i].click();
					return;
				}
			}
			console.log('sanity error, government'+change_government+'not found');
		}
	}
	// always gather resources because we can ("free" production). does only 1
	// click per resource per call of this function.
	// this also tries to buy from slave market (which is desirable) and tries
	// to buy horseshoes (not always fine). TODO fix so we don't buy horseshoes
	// if we have more than x unused (for a suitable x, like 30)
	// TODO handle stuff here that's not gathering, like sacrificial altar
	for(let i=document.getElementById('city-dist-outskirts').nextSibling;i.className!='city';i=i.nextSibling) {
		if(i.id!='city-s_alter' && i.id!='city-horseshoe' && i.className=='action vb') i.__vue__.action();
	}
	// always try to research techs
	// dubious hardcoded indexes, fix whenever this breaks
	// TODO maybe ensure we research hunter process before other titanium techs
	// (hoes, axes etc)
	let tech=document.getElementById('mTabResearch').childNodes[2].childNodes[1].firstChild;
	for(let i=0;i<tech.childNodes.length;i++) {
		// skip techs we don't need for mad reset
		if(MADavoidtechs.has(tech.childNodes[i].id)) continue;
		// if not terrifying (balorg): avoid combat techs
		if(!evolve.global.race.hasOwnProperty('terrifying') && MADavoidcombattechs.has(tech.childNodes[i].id)) continue;
		// 'action vb' means tech is buyable now. if string contains 'cna' (can't
		// afford) or 'cnam' (cost too high for our caps) we can't buy
		// (we can click to put into queue though, but script never queues)
		if(tech.childNodes[i].className=='action vb') {
			// ignore tech if it's not clickable because of precognition
			if(tech.childNodes[i].firstChild!=null) {
				if(tech.childNodes[i].firstChild.className=='button is-dark res-Knowledge precog') continue;
			}
			tech.childNodes[i].__vue__.action();
			// TODO output to message log to be fancy? only bother if it's easy
			return; // only do 1 action per call, let game react before our next action
		}
	}
	// set smelter: 5 on iron, the rest on steel. if <10, distribute evenly
	if(evolve.global.city.hasOwnProperty('smelter') && evolve.global.city.smelter.hasOwnProperty('Steel')) {
		let q=document.getElementById('smelterMats');
		if(q!=null) {
			let iron=evolve.global.city.smelter.Iron,steel=evolve.global.city.smelter.Steel;
			while(iron>steel || iron>5) {
				iron--; steel++;
				q.childNodes[1].childNodes[5].click();
			}
			// in the off chance that iron is too low
			while(iron+steel>9 && iron<5) {
				iron++; steel--;
				q.childNodes[1].childNodes[2].click();
			}
		}
	}
	// set governor to educator as soon as we can
	{
		let q=document.getElementById('candidates');
		if(q!=null) for(let i=1;;i++) if(q.childNodes[i].className=='appoint educator') {
			q.__vue__.appoint(i-1);
			return;
		}
	}
	// change government (opens modal only, doesn't actually change yet)
	if(evolve.global.civic.govern.type=='anarchy') {
		let q=document.getElementById('govType');
		if(q!=null) {
			// check if visible
			if(q.getAttribute('style')!='display: none;') {
				// set global variable
				change_government='democracy';
				// spawn modal
				q.childNodes[1].firstChild.firstChild.click();
				return;
			}
		}
	}
	// set governor crate construction and management tasks
	{
		let q=document.getElementById('govOffice');
		if(q!=null) {
			let change_to=['Crate/Container Construction','Crate/Container Management'];
			for(let i=0;i<2;i++) if(q.childNodes[i+1].childNodes[1].firstChild.firstChild.firstChild.innerHTML=='None') {
				// task i is none: set to crate construction or management
				let r=q.childNodes[i+1].childNodes[1].childNodes[2].firstChild;
				for(let j=0;j<r.childNodes.length;j++) {
					let s=r.childNodes[j];
					if(s.innerHTML==change_to[i]) {
						s.click();
						return;
					}
				}
			}
		}
	}
	// if no rock quarry: build one to unlock quarry workers (unless we're plant)
	// TODO error handling if variable doesn't exist. test with plant
	if(evolve.global.city.hasOwnProperty('rock_quarry') && evolve.global.city.rock_quarry.count==0) {
		let q=document.getElementById('city-rock_quarry');
		if(q!=null && q.className=='action vb') {
			q.__vue__.action();
			return;
		}
	}
	// assign workers and crafters
	// distribute crafters evenly only if sheet metal or quantium or scarletite
	// don't exist
	{
		let eq=true;
		if(document.getElementById('foundry').childNodes.length==0) eq=false;
		else ; // TODO actually implement the second case
		assign_population(eq);
	}
	// set mimic
	// priority: heat > avian > plant > small
	// having kindling kindred makes script not take heat
	// TODO doesn't work for nano currently
	{
		let q=document.getElementById('sshifter');
		if(q!=null && q.childNodes.length>2) {
			if(q.childNodes[2].firstChild.firstChild.firstChild.innerHTML=='None') {
				let str='Heat';
				if(evolve.global.race.maintype=='heat' || (evolve.global.race.hasOwnProperty('ss_genus') && evolve.global.race.ss_genus=='heat') || evolve.global.race.hasOwnProperty('kindling_kindred')) {
					str='Avian';
					if(evolve.global.race.maintype=='avian' || (evolve.global.race.hasOwnProperty('ss_genus') && evolve.global.race.ss_genus=='avian')) {
						str='Plant';
						if(evolve.global.race.maintype=='plant' || (evolve.global.race.hasOwnProperty('ss_genus') && evolve.global.race.ss_genus=='plant')) {
							str='Small';
						}
					}
				}
				let r=q.childNodes[2].childNodes[2].firstChild;
				for(let i=0;i<r.childNodes.length;i++) if(r.childNodes[i].innerHTML==str) {
					r.childNodes[i].click();
					return;
				}
			}
		}
	}
	// synth race needs to build population
	{
		let q=document.getElementById('city-assembly');
		if(q!=null) {
			if(q.className=='action vb' && evolve.global.resource[race.species].amount<evolve.global.resource[race.species].max) {
				q.__vue__.action();
				return;
			}
		}
	}
	// TODO synth needs to build transmitters
	// assign servants equally. could be smarter, but whatever
	if(evolve.global.race.hasOwnProperty('servants')) assign_jobs_equally(document.getElementById('servants'),evolve.global.race.servants.max);
	// assign skilled servants equally
	if(evolve.global.race.hasOwnProperty('servants')) assign_jobs_equally(document.getElementById('skilledServants'),evolve.global.race.servants.smax);
	// less than 10 population: build any housing from residential block
	if(evolve.global.resource[race.species].amount<10) {
		// if we need horseshoes and don't have mines, build one
		// then build horseshoes
		if(evolve.global.resource.hasOwnProperty('Horseshoe') && evolve.global.resource[race.species].amount+evolve.global.resource.Horseshoe.amount<10) {
			if(!evolve.global.city.hasOwnProperty('mine') || evolve.global.city.mine.count==0) {
				if(build_city(['mine'])) return;
			}
			for(let i=document.getElementById('city-dist-outskirts').nextSibling;i.className!='city';i=i.nextSibling) {
				if(i.id=='city-horseshoe' && i.className=='action vb') {
					i.__vue__.action();
					return;
				}
			}
		}
		for(let i=document.getElementById('city-dist-residential').nextSibling;i.className!='city';i=i.nextSibling) {
			if(i.className=='action vb') {
				i.__vue__.action();
				return;
			}
		}
		// exit, don't continue script before we have 10 population
		// TODO try to turn this off, and benchmark both variants
		return;
	}
	// build horseshoes up to 6 stored
	for(let i=document.getElementById('city-dist-outskirts').nextSibling;i.className!='city';i=i.nextSibling) {
		if(i.id=='city-horseshoe' && i.className=='action vb' && evolve.global.resource.Horseshoe.amount<6) {
			i.__vue__.action();
			return;
		}
	}
	// if we're missing a building that's deemed vital, focus on building at
	// least one of it
	// TODO might be beneficial to build some more mines
	{
		let vital=['bank','garrison','silo','shed','cement_plant','foundry','mine','coal_mine','smelter','storage_yard','trade','oil_well','oil_depot','mill','graveyard','soul_well','farm'];
		let missing=false;
		for(building of vital) if(evolve.global.city.hasOwnProperty(building) && evolve.global.city[building].count==0) {
			// try building one of them
			missing=true;
			let q=document.getElementById('city-'+building);
			if(q.className=='action vb') {
				q.__vue__.action();
				return;
			}
			if(q.className=='action cna cnam vb') {
				// we don't have cap, build storage
				if(build_city(['shed','bank'])) return;
			}
			// special case for freight yard when we can't even craft every element
			if(building=='storage_yard' && evolve.global.city.foundry.count<4) {
				if(build_city(['foundry'])) return;
			}
		}
		// if none of the missing buildings could be built, abort script and try
		// to build these later
		if(missing) return;
	}
	// if we have unbuilt crates and steel cap is low: build a crate
	// governor task waits until 1000 plywood which can take very long
	if(evolve.global.resource.Crates.max>0 && evolve.global.resource.Crates.amount==0 && evolve.global.resource.Steel.max<5000) {
		build_crate();
		return;
	}
	// TODO if we haven't unlocked governors, assign crates to steel

	// if we have discovered titanium but don't have hunter process: trade for
	// titanium
	if(evolve.global.resource.Titanium.display) {
		let q=document.getElementById('market-Titanium');
		let r=getchildbyclassname(q,'trade');
		if(!evolve.global.tech.hasOwnProperty('titanium')) {
			if(num_traderoutes('Titanium')==0) {
				// very arbitratily set number of trade routes
				// TODO set a more sensible number if i can get money production
				let r=getchildbyclassname(q,'trade');
				for(let i=0;i<10;i++) r.childNodes[3].childNodes[1].firstChild.click();
			}
			// if we lose money, remove some trade routes
			if(get_production('Money')<0) r.childNodes[1].childNodes[1].firstChild.click();
		} else {
			// we have hunter process, cancel titanium trade routes
			if(num_traderoutes('Titanium')>0) r.childNodes[4].click();
		}
	}
	// if we have discovered alloy but don't have uranium storage: trade for alloy
	if(evolve.global.resource.Alloy.display) {
		let q=document.getElementById('market-Alloy');
		let r=getchildbyclassname(q,'trade');
		if(!evolve.global.tech.hasOwnProperty('uranium') || evolve.global.tech.uranium==1) {
			if(num_traderoutes('Alloy')==0) {
				// very arbitratily set number of trade routes
				// TODO set a more sensible number if i can get money production
				for(let i=0;i<20;i++) r.childNodes[3].childNodes[1].firstChild.click();
			}
			// if we lose money, remove some trade routes
			if(get_production('Money')<0) r.childNodes[1].childNodes[1].firstChild.click();
		} else {
			// we have hunter process, cancel titanium trade routes
			if(num_traderoutes('Alloy')>0) r.childNodes[4].click();
		}
	}
	// if we have uranium storage but haven't researched rocketry or mad: trade for oil
	if(evolve.global.resource.Oil.display) {
		let q=document.getElementById('market-Oil');
		let r=getchildbyclassname(q,'trade');
		if(evolve.global.tech.hasOwnProperty('uranium') && evolve.global.tech.uranium==2 && !evolve.global.tech.hasOwnProperty('mad')) {
			if(num_traderoutes('Oil')==0) {
				// very arbitratily set number of trade routes
				// TODO set a more sensible number if i can get money production
				for(let i=0;i<35;i++) r.childNodes[3].childNodes[1].firstChild.click();
			}
			// if we lose money, remove some trade routes
			if(get_production('Money')<0) r.childNodes[3].childNodes[1].firstChild.click();
		} else if(evolve.global.tech.hasOwnProperty('mad')) {
			// cancel oil trade routes when we have mad
			if(num_traderoutes('Oil')>0) r.childNodes[4].click();
		}
	}
	// if we have uranium storage and rocketry but haven't researched mad: trade for uranium
	if(evolve.global.resource.Uranium.display) {
		let q=document.getElementById('market-Uranium');
		let r=getchildbyclassname(q,'trade');
		if(evolve.global.tech.hasOwnProperty('uranium') && evolve.global.tech.uranium==2 && !evolve.global.tech.hasOwnProperty('mad') && evolve.global.tech.high_tech>=7) {
			if(num_traderoutes('Uranium')==0) {
				// very arbitratily set number of trade routes
				// TODO set a more sensible number if i can get money production
				for(let i=0;i<35;i++) r.childNodes[3].childNodes[1].firstChild.click();
			}
			// if we lose money, remove some trade routes
			if(get_production('Money')<0) r.childNodes[1].childNodes[1].firstChild.click();
		} else {
			// we have hunter process, cancel titanium trade routes
			if(num_traderoutes('Uranium')>0) r.childNodes[4].click();
		}
	}
	// build buildings we can't have enough of, like population and production
	// boosts that don't require population (so temples are ok, filling them is
	// somewhat low priority)
	if(build_city(['basic_housing','cottage','lodge','farm','temple','garrison','lumber_yard','smelter','metal_refinery','amphitheatre','trade','oil_well','bank','captive_housing','graveyard','soul_well'])) return;
	// can still build miners if we are waiting for power buildings
	if(build_city(['mine'])) return;
	// build tech buildings until we have enough knowledge for rocketry and MAD
	let need_knowledge=-1;
	{
		let q=document.getElementById('tech-rocketry');
		if(q) need_knowledge=q.firstChild.getAttribute('data-knowledge');
		q=document.getElementById('tech-mad');
		if(q) {
			let cost=q.firstChild.getAttribute('data-knowledge');
			if(need_knowledge<cost) need_knowledge=cost;
		}
		if(need_knowledge<0) need_knowledge=120000;
		if(evolve.global.resource.Knowledge.max<need_knowledge) {
			if(build_city(['university','library'])) return;
			// TODO if we have unicorn shrines: build on waning gibbous moon only (knowledge)
		}
	}
	// if we have power deficit, build power buildings (not fission reactors)
	{
		if(evolve.global.tech.hasOwnProperty('high_tech') && evolve.global.tech.high_tech>=2) {
			let q=document.getElementById('powerMeter');
			let r=document.getElementById('city-mill');
			if(r!=null && r.childNodes.length>=4) {
				let num=r.childNodes[3].innerHTML;
				while(num--) r.childNodes[2].click();
			}
			if(q.innerHTML<0) {
				if(build_city(['coal_power','oil_power'])) return;
				// build windmills after they give power, and turn all on
				if(evolve.global.tech.agriculture>=6) {
					if(r!=null && r.className=='action vb') r.click();
					if(build_city(['mill'])) return;
				}
				// returning here is really bad
				//return;
			}
		}
	}
	if(evolve.global.resource.Knowledge.max<need_knowledge) {
		if(build_city(['wardenclyffe','biolab'])) return;
		// TODO if we have unicorn shrines: build on waning gibbous moon only (knowledge)
	}
	// build buildings we can't have enough of that require power
	if(build_city(['rock_quarry','sawmill','apartment','factory'])) return;
	// build more production buildings when all vital specialist worker slots are
	// full (bankers, priests, tormentors are not deemed vital)
	if(!free_worker_slots(['miner','cement_worker','craftsman'])) {
		if(build_city(['foundry','mine','cement_plant','coal_mine'])) return;
	}
	// if any of the buildings we want are capped, build banks and storage
	// (script isn't smart enough to increase just the capped resource)
	// TODO don't build freight yards if we have unbuilt crates, don't build
	//      container thingy if we have unbuilt containers
	if(city_iscapped(['basic_housing','cottage','farm','university','lumber_yard','rock_quarry','bank','coal_power','oil_power'])) {
		if(build_city(['shed','warehouse'])) return;
		if(evolve.global.resource.Crates.max>evolve.global.resource.Crates.amount) {
			build_crate();
			return;
		} else if(build_city(['storage_yard'])) return;
	}
	// specific for terrifying trait (balorg): attack for resources
	// assault, only when we have full army with no wounded
	if(evolve.global.race.hasOwnProperty('terrifying')) {
		if(build_city(['hospital','boot_camp'])) return;
		if(evolve.global.civic.garrison.workers==evolve.global.civic.garrison.max && evolve.global.civic.garrison.wounded==0) {
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
				// only tries to attack the first foreign power
				let s=document.getElementById('gov0');
				if(s!=null) s.childNodes[2].firstChild.click()
			}
		}
	}

	// TODO for races that are struggling with food, buy mill


	// TODO more government tasks? matter replicator
	// TODO support specific circumstances
	//      synth: assemble citizens, ensure we have enough power
	//      balorg: raid for titanium
	//      - research armor, mercenaries, zealotry
	//      - build hospitals, boot camps
	//      - maybe let spies sabotage foreign powers
	//      - raid foreign powers
	//      - hire mercenaries because waiting for training is extremely slow
	//      - make sure hunter process is the first thing built that costs titanium
	//      evil universe: handle authority without tanking the run
	//      magic universe: support crystal mining
	//      bonus: support valdi MAD
	//      handle high population (insect races)

	// TODO make the entire thing smarter, care about objectives
	// - if we have mimic (or get it later in the run):
	//   - heat is default genus
	//   - if we have kindling kindred or are already heat: avian
	//   - if we already are avian and (heat or kindling kindred): sand?
	//   - if we already are avian and sand? and kindling kindred: small?
	// - when electricity is unlocked, prioritize power generation hard
	// - when industrialization is researched, buy titanium
	// - turn on windmills
	// - build 1 factory
	// - when we have hunter process and 1 factory, stop buying titanium, buy alloy
	// - research uranium storage, stop buying alloy, buy oil and uranium
}

// run the above function once per second
setInterval(MAD_bot, 1000);
