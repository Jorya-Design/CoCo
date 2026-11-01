"""Generate an editable Excalidraw scene and an SVG architecture overview."""
import json
from pathlib import Path
from xml.sax.saxutils import escape

out = Path(__file__).resolve().parent.parent / "docs"
out.mkdir(exist_ok=True)
elements = []
svg = []
counter = 0
ink = "#534963"
purple = "#7b61aa"

def base(kind, x, y, w, h, **fields):
    global counter
    counter += 1
    return dict(id="coco-architecture-" + str(counter), type=kind, x=x, y=y,
        width=w, height=h, angle=0, strokeColor=ink, backgroundColor="transparent",
        fillStyle="solid", strokeWidth=1.5, strokeStyle="solid", roughness=1,
        opacity=100, groupIds=[], frameId=None, roundness=None, seed=1000+counter,
        version=1, versionNonce=2000+counter, isDeleted=False, boundElements=[],
        updated=1793534400000, link=None, locked=False, **fields)

def text(x, y, lines, size=23, color=ink, width=1100, group=None):
    lines = lines.split("\n")
    e = base("text", x, y, width, len(lines)*size*1.3,
        text="\n".join(lines), originalText="\n".join(lines), fontSize=size,
        fontFamily=2, textAlign="left", verticalAlign="top", containerId=None,
        autoResize=True, lineHeight=1.3)
    e["strokeColor"] = color
    if group: e["groupIds"] = [group]
    elements.append(e)
    for i, line in enumerate(lines):
        svg.append('<text x="%s" y="%s" fill="%s" font-size="%s">%s</text>' %
            (x, y+size+i*size*1.3, color, size, escape(line)))

def box(x, y, w, h, title, detail, fill="#ffffff", future=False):
    e = base("rectangle", x,y,w,h)
    e.update(backgroundColor=fill, roundness={"type":3}, strokeStyle="dashed" if future else "solid")
    e["groupIds"] = [e["id"]+"-group"]
    elements.append(e)
    svg.append('<rect x="%s" y="%s" width="%s" height="%s" rx="14" fill="%s" stroke="%s" stroke-width="1.5" %s/>' %
        (x,y,w,h,fill,ink,'stroke-dasharray="10 7"' if future else ""))
    text(x+22,y+20,title,25,purple,w-44,e["groupIds"][0])
    text(x+22,y+64,detail,19,ink,w-44,e["groupIds"][0])
    return e

def arrow(x1,y1,x2,y2,label=None,lx=None,ly=None):
    e = base("arrow",min(x1,x2),min(y1,y2),abs(x2-x1),abs(y2-y1))
    e.update(x=x1,y=y1,points=[[0,0],[x2-x1,y2-y1]],lastCommittedPoint=None,
        startBinding=None,endBinding=None,startArrowhead=None,endArrowhead="arrow",elbowed=False)
    elements.append(e)
    svg.append('<path d="M %s %s L %s %s" fill="none" stroke="%s" stroke-width="2" marker-end="url(#arrow)"/>'%(x1,y1,x2,y2,ink))
    if label: text(lx,ly,label,16,"#887893",400)

text(40,30,"CoCo · multiplayer Codex harness",38,purple)
text(40,90,"Plan together → approve a snapshot → execute a DAG → review the diff",21)
text(40,145,"FIREBASE FOUNDATION · INITIAL RELEASE",17,"#9a8aa5")
box(40,200,250,120,"Guests + members","Public read-only\n2 verified editors",fill="#f6f3fa")
box(380,200,400,120,"React + shadcn/ui","Chat + CRDT plan + task DAG\nServed by Firebase Hosting",fill="#eee8f7")
box(870,200,290,120,"GitHub Actions","PR: test + build\nMain: deploy checked build",fill="#f6f3fa")
arrow(300,260,370,260)
arrow(860,260,790,260)
text(793,224,"CD",15)
box(40,425,275,150,"Firebase Auth","Email + verification\nIdentity for room access",fill="#fff6e4")
box(380,425,780,150,"Cloud Firestore · London","Yjs binary update log + chat + presence + memberships\nImmutable approvals · server-owned runs and events",fill="#fff6e4")
arrow(470,332,200,413,"sign in",270,348)
arrow(650,332,650,413,"live CRDT updates",674,357)
text(40,632,"LINUX EXECUTION SERVICE · NEXT MILESTONE",17,"#9a8aa5")
box(40,710,1120,160,"Control plane · planner + DAG validator + scheduler",
    "Read approved snapshots; validate task contracts and pin the Git base SHA.\nDispatch with durable leases and attempt IDs; stream real events to Firestore.",
    fill="#f4f7f5",future=True)
arrow(780,587,780,698,"approved snapshots ↓     events ↑",800,633)
box(40,1000,340,150,"Codex · UI task","Isolated sandbox + worktree\nCommit SHA + check results",fill="#f8f6fb",future=True)
box(430,1000,340,150,"Codex · service task","Isolated sandbox + worktree\nCommit SHA + check results",fill="#f8f6fb",future=True)
box(820,1000,340,150,"Codex · test task","Isolated sandbox + worktree\nCommit SHA + check results",fill="#f8f6fb",future=True)
arrow(220,882,220,988)
arrow(600,882,600,988,"map · parallel tasks",620,918)
arrow(990,882,990,988)
box(285,1260,630,135,"Reduce · integrate and validate","Merge dependency commits in order; resolve conflicts.\nRun acceptance checks against the integrated result.",fill="#f4f7f5",future=True)
arrow(210,1162,380,1248)
arrow(600,1162,600,1248)
arrow(990,1162,820,1248)
box(40,1495,1120,110,"Team reviews the result","Final branch + integrated diff + actual check results · merge after review",fill="#eee8f7",future=True)
arrow(600,1407,600,1483)
text(40,1650,"Solid: initial Firebase app     Dashed: planned Linux worker integration",18,"#928199")

scene = {"type":"excalidraw","version":2,"source":"CoCo","elements":elements,
    "appState":{"viewBackgroundColor":"#ffffff","gridSize":None},"files":{}}
(out/"architecture.excalidraw").write_text(json.dumps(scene,indent=2))
header = '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1710" viewBox="0 0 1200 1710"><defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="'+ink+'"/></marker></defs><rect width="1200" height="1710" fill="#fff"/><g font-family="Inter,Arial,sans-serif">'
(out/"architecture.svg").write_text(header+"".join(svg)+"</g></svg>")
print("Generated editable Excalidraw scene and SVG overview.")
