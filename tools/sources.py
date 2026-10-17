import yaml, glob, json, os, re, sys
R=os.environ.get('FUNKY', os.path.expanduser('~/funky'))+'/Resources'
class L(yaml.SafeLoader): pass
def any_tag(loader, suffix, node):
    if isinstance(node, yaml.MappingNode): d = loader.construct_mapping(node, deep=True); d['__type']=suffix; return d
    if isinstance(node, yaml.SequenceNode): return loader.construct_sequence(node, deep=True)
    return loader.construct_scalar(node)
L.add_multi_constructor('!type:', any_tag); L.add_multi_constructor('!', any_tag)
ents={}; meals=[]; constructs=[]
for f in glob.glob(R+'/Prototypes/**/*.yml', recursive=True):
    try: docs=yaml.load(open(f,encoding='utf-8'),Loader=L) or []
    except Exception as e: continue
    for d in docs:
        if not isinstance(d,dict): continue
        t=d.get('type')
        if t=='entity' and d.get('id'): ents[d['id']]=d
        elif t=='microwaveMealRecipe': meals.append(d)
loc={}
for f in glob.glob(R+'/Locale/en-US/**/*.ftl', recursive=True):
    for line in open(f,encoding='utf-8'):
        m=re.match(r'^([a-zA-Z0-9\-_.]+)\s*=\s*(.*)$', line.strip())
        if m: loc[m.group(1)]=m.group(2)
def merge(a,b):
    if isinstance(a,dict) and isinstance(b,dict):
        o=dict(a)
        for k,v in b.items(): o[k]=merge(a[k],v) if k in a else v
        return o
    return b
cache={}
def resolve(i, depth=0):
    if i in cache: return cache[i]
    e=ents.get(i)
    if not e or depth>30: return None
    ps=e.get('parent') or []
    if isinstance(ps,str): ps=[ps]
    comps={}; base={}
    for p in ps:
        r=resolve(p, depth+1)
        if r:
            for c in r['components']: comps[c]=merge(comps.get(c,{}), r['components'][c])
            for k in ('name','description','suffix'):
                if r.get(k) and k not in base: base[k]=r[k]
    for c in e.get('components') or []:
        if isinstance(c,dict) and c.get('type'): comps[c['type']]=merge(comps.get(c['type'],{}), c)
    out={'id':i,'components':comps,'abstract':e.get('abstract',False)}
    for k in ('name','description','suffix'):
        out[k]=e.get(k, base.get(k))
    cache[i]=out; return out
def entname(i):
    r=resolve(i)
    if not r: return i
    n=r.get('name') or ''
    n=loc.get(n,n) if n else i
    return re.sub(r'\{[^}]*\}','',n).strip() or i
src={}  # reagent -> list
for i in ents:
    r=resolve(i)
    if not r or r['abstract']: continue
    ex=r['components'].get('Extractable')
    if not ex: continue
    if 'MobState' in r['components'] or i in ('Pill',): continue
    produce='Produce' in r['components']
    sols=(r['components'].get('SolutionContainerManager') or {}).get('solutions') or {}
    stack='Stack' in r['components']
    cnt=(r['components'].get('Stack') or {}).get('count')
    def add(rid, q, how):
        src.setdefault(rid,[]).append({'e':i,'n':entname(i),'q':q,'how':how,'stack':stack,'cnt':cnt,'suffix':r.get('suffix'),'pr':produce})
    gs=ex.get('grindableSolutionName')
    if gs and gs in sols:
        for rq in sols[gs].get('reagents') or []:
            if isinstance(rq,dict) and rq.get('ReagentId'): add(rq['ReagentId'], float(rq.get('Quantity',0)), 'grind')
    js=ex.get('juiceSolution')
    if isinstance(js,dict):
        for rq in js.get('reagents') or []:
            if isinstance(rq,dict) and rq.get('ReagentId'): add(rq['ReagentId'], float(rq.get('Quantity',0)), 'juice')
# dedupe: same name+how+q keep one; prefer entity without suffix, singles of stacks
out={}
for rid,lst in src.items():
    seen={}
    for s in lst:
        key=(s['n'].lower(), s['how'])
        cur=seen.get(key)
        def rank(x): return (1 if x['suffix'] else 0, 0 if (x['cnt'] in (None,1)) else 1)
        if not cur or rank(s)<rank(cur): seen[key]=s
    vals=sorted(seen.values(), key=lambda s:(-s['q']))
    out[rid]=[{'n':s['n'],'q':s['q'],'how':s['how'],'stack':s['stack'],'e':s['e'],'pr':s['pr']} for s in vals]
mealout=[]
for m in meals:
    res=m.get('result'); rg=m.get('reagents') or {}; so=m.get('solids') or {}
    mealout.append({'id':m.get('id'),'result':res,'rn':entname(res),'group':m.get('group'),'time':m.get('time'),
        'solids':[{'e':k,'n':entname(k),'c':v} for k,v in so.items()],'reagents':rg,
        'desc':(lambda r: loc.get(r.get('description') or '', r.get('description') or '') if r else '')(resolve(res) or {})})
# names for guidebook entity embeds
json.dump({'sources':out,'meals':mealout}, open('sources.json','w'))
gb_ents=set(sys.argv[1:]) | set(json.load(open('gbsel.json'))['ents'])
# every entity the UI shows a sprite for: grinder/juicer sources and microwave recipe results/ingredients
for _lst in out.values():
    for _s in _lst: gb_ents.add(_s['e'])
for _m in mealout:
    gb_ents.add(_m['result']); gb_ents.update(x['e'] for x in _m['solids'])
def sprite(e):
    r=resolve(e)
    if not r: return None
    sp=r['components'].get('Sprite') or {}
    path=sp.get('sprite'); state=sp.get('state')
    layers=sp.get('layers') or []
    if not state:
        for l in layers:
            if isinstance(l,dict) and l.get('state'):
                state=l['state']; path=l.get('sprite',path); break
    if not path:
        for l in layers:
            if isinstance(l,dict) and l.get('sprite'): path=l['sprite']; break
    return [path,state] if path and state else None
json.dump({e:{'n':entname(e),'s':sprite(e)} for e in sorted(gb_ents)}, open('entnames.json','w'))
print(len(ents), len(out), len(mealout))
for k in ['Plasma','Water','Oil','Aloe','Uranium','Silver','Gold','Blood','Fat','Ash','UnstableMutagen','Frezon','Charcoal','Stellibinin','Histamine','Benzene','Protein']:
    print(k, [(s['n'],s['q'],s['how']) for s in out.get(k,[])[:5]], len(out.get(k,[])))
print([ (m['rn'], m['solids'], m['reagents']) for m in mealout if m.get('group')=='Medicinal'])
