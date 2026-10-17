import json, re
d=json.load(open('raw.json')); loc=d['loc']
rg={r['id']:r for r in d['reagents']}
def resolve(r, seen=()):
    p=r.get('parent')
    if isinstance(p,list): p=p[0] if p else None
    if p and p in rg and p not in seen:
        base=resolve(rg[p], seen+(p,)); out=dict(base); out.pop('abstract',None); out.update(r); return out
    return r
def L(k, fb=''):
    if not k: return fb
    v=loc.get(k, fb or k)
    v=re.sub(r'\{[^}]*\}','',v).strip()
    return v
DISP=['Aluminium','Carbon','Chlorine','Copper','Ethanol','Fluorine','Sugar','Hydrogen','Iodine','Iron','Lithium','Mercury','Nitrogen','Oxygen','Phosphorus','Potassium','Radium','Silicon','Sodium','Sulfur','WeldingFuel']
def cond_txt(c, rname):
    t=c.get('__type')
    if t=='ReagentThreshold':
        who = '' if not c.get('reagent') else (L(rg.get(c['reagent'],{}).get('name'),c['reagent'])+' ')
        s=[]
        if c.get('min') is not None and float(c['min'])>0: s.append(f"{who}≥{c['min']}u")
        if c.get('max') is not None: s.append(f"{who}<{c['max']}u")
        return ' '.join(s) or None
    if t=='Temperature':
        s=[]
        if c.get('min') is not None: s.append(f"body ≥{c['min']}K")
        if c.get('max') is not None: s.append(f"body ≤{c['max']}K")
        return ' '.join(s)
    if t=='MobStateCondition': return ('not ' if c.get('inverted') else '')+'while '+str(c.get('mobstate','?')).lower()
    if t=='TotalDamage':
        s=[]
        if c.get('min') is not None: s.append(f"dmg ≥{c['min']}")
        if c.get('max') is not None: s.append(f"dmg <{c['max']}")
        return ' '.join(s)
    if t=='OrganType': return ('not ' if c.get('shouldHave') is False else '')+str(c.get('type','')).lower()+' organs'
    if t=='BloodReagentThreshold': return 'blood reagent threshold'
    if t=='JobCondition': return 'job-specific'
    return t
reagents={}
for rid,r0 in rg.items():
    r=resolve(r0)
    if r.get('abstract'): continue
    eff=[]; rate=None; thr=None
    for mname,m in (r.get('metabolisms') or {}).items():
        if not isinstance(m,dict): continue
        if mname in('Medicine','Poison','Narcotic') or rate is None: rate=m.get('metabolismRate', rate)
        for e in m.get('effects') or []:
            if not isinstance(e,dict): continue
            conds=[x for x in (e.get('conditions') or []) if isinstance(x,dict)]
            ct=[cond_txt(c,rid) for c in conds]; ct=[x for x in ct if x]
            for c in conds:
                if c.get('__type')=='ReagentThreshold' and not c.get('reagent') and c.get('min') and float(c['min'])>0:
                    thr = float(c['min']) if thr is None else min(thr,float(c['min']))
            t=e.get('__type')
            if t=='HealthChange':
                dm=e.get('damage') or {}; dd={**(dm.get('groups') or {}),**(dm.get('types') or {})}
                dd={k:round(float(v),3) for k,v in dd.items()}
                eff.append({'t':'dmg','d':dd,'c':ct, 'm':mname})
            elif t in ('Oxygenate','ModifyBleedAmount','ModifyBloodLevel','AdjustTemperature','CureZombieInfection','ChemCleanBloodstream','ReduceRotting','MovespeedModifier','GenericStatusEffect','ChemVomit','Jitter','Drunk','Electrocute','Polymorph','ModifyLungGas','FlammableReaction','Emote'):
                info={}
                for k in ('amount','key','time','type','walkSpeedModifier','sprintSpeedModifier','probability','scaled','refresh'):
                    if k in e and k!='__type': info[k]=e[k]
                eff.append({'t':t,'c':ct,'i':info,'m':mname})
    touch=[]
    for cat,v in (r.get('reactiveEffects') or {}).items():
        if not isinstance(v,dict): continue
        for e in v.get('effects') or []:
            if not isinstance(e,dict):
                touch.append({'t':cat}); continue
            t=e.get('__type')
            if t in ('HealthChange','EvenHealthChange'):
                dm=e.get('damage') or {}
                dd={**(dm.get('groups') or {}),**(dm.get('types') or {})} if ('groups' in dm or 'types' in dm) else dm
                touch.append({'t':'dmg','d':{k:float(x) for k,x in dd.items()},'per':bool(e.get('scaleByQuantity'))})
            elif t=='FlammableReaction': touch.append({'t':'Flammable','m':e.get('multiplier')})
            elif t=='ModifyBleedAmount': touch.append({'t':'bleed','a':e.get('amount')})
            elif t=='Emote': pass
            else: touch.append({'t':t})
    reagents[rid]={
        'touch':touch,'fl':r.get('flammability'),
        'n':L(r.get('name'),rid),'d':L(r.get('desc'),''),'g':r.get('group') or '',
        'c':r.get('color','#888888'),'rate':rate,'thr':thr,'e':eff,
        'f':r0['__file'].split('/')[0],
    }
reactions=[]
for x in d['reactions']:
    if not x.get('reactants'): continue
    fx=[]
    for e in x.get('effects') or []:
        if isinstance(e,dict): fx.append({k:v for k,v in e.items() if k in('__type','gas','entity','explosionType','prototypeId')})
        elif e=='' : fx.append({'__type':'FlashReactionEffect'})
    reactions.append({'id':x['id'],
        'r':{k:[float(v.get('amount',1)), bool(v.get('catalyst',False))] for k,v in x['reactants'].items()},
        'p':{k:float(v) for k,v in (x.get('products') or {}).items()},
        'minT':float(x.get('minTemp',0)),'maxT':float(x['maxTemp']) if x.get('maxTemp') is not None else None,
        'mix':x.get('requiredMixerCategories') or None,'pri':int(x.get('priority',0)),
        'q':bool(x.get('quantized',False)),'ce':x.get('conserveEnergy',True) is not False,
        'fx':fx,'f':x['__file'].split('/')[-1].replace('.yml','') , 'src':x['__file'].split('/')[0]})
# check flash effect raw
fl=[r for r in reactions if r['id']=='Flash'][0]; fl['fx']=[{'__type':'FlashReactionEffect'}]
for r in reactions:
    for k in list(r['r'])+list(r['p']):
        if k not in reagents: reagents[k]={'n':k,'d':'','g':'','c':'#888888','rate':None,'thr':None,'e':[],'f':'?'}
S=json.load(open('sources.json'))
for rid,lst in S['sources'].items():
    if rid in reagents: reagents[rid]['src']=lst[:8]
meals=[m for m in S['meals'] if m.get('group')=='Medicinal' and m.get('reagents')]
out={'meals':meals,'reagents':reagents,'reactions':reactions,'dispenser':DISP,
     'containers':{'Beaker':50,'Large beaker':100,'Jug':200,'Bucket':250,'Bluespace beaker':1000},
     'mixers':{}}
json.dump(out, open('data.json','w'), separators=(',',':'), ensure_ascii=False)
import os; print(os.path.getsize('data.json'), len(reagents), len(reactions))
