import yaml, glob, json, re, sys, os
R = os.environ.get('FUNKY', os.path.expanduser('~/funky'))+'/Resources'
class L(yaml.SafeLoader): pass
def any_tag(loader, suffix, node):
    if isinstance(node, yaml.MappingNode): d = loader.construct_mapping(node, deep=True); d['__type']=suffix; return d
    if isinstance(node, yaml.SequenceNode): return loader.construct_sequence(node, deep=True)
    return loader.construct_scalar(node)
L.add_multi_constructor('!type:', any_tag)
L.add_multi_constructor('!', any_tag)
def load(globs):
    out=[]
    for g in globs:
        for f in sorted(glob.glob(R+'/Prototypes/'+g, recursive=True)):
            try: docs = yaml.load(open(f, encoding='utf-8'), Loader=L) or []
            except Exception as e: print('ERR', f, e, file=sys.stderr); continue
            for d in docs:
                if isinstance(d, dict): d['__file']=f.replace(R+'/Prototypes/',''); out.append(d)
    return out
allp = load(['**/*.yml'])
reactions=[d for d in allp if d.get('type')=='reaction']
reagents=[d for d in allp if d.get('type')=='reagent']
# locale
loc={}
for f in glob.glob(R+'/Locale/en-US/**/*.ftl', recursive=True):
    for line in open(f, encoding='utf-8'):
        m=re.match(r'^([a-z0-9\-]+)\s*=\s*(.*)$', line.strip())
        if m: loc[m.group(1)]=m.group(2)
print(len(reactions), len(reagents), len(loc), file=sys.stderr)
json.dump({'reactions':reactions,'reagents':reagents,'loc':loc}, open('raw.json','w'), default=str, indent=0)
