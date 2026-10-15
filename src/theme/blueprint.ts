// Blueprint theme: isometric blueprint look of the original ai-explainer engine.
// Blocks only ask for roles and type sizes from here, never hard-coded colours or fonts.
import type { Theme } from '../types.ts';

// Barlow Condensed Bold advance widths (em). Kerning is disabled when drawing, so these match the canvas.
const ADV: Record<string, number> = {" ":0.2,"!":0.279,"\"":0.346,"#":0.616,"$":0.444,"%":0.766,"&":0.603,"'":0.17,"(":0.311,")":0.311,"*":0.361,"+":0.438,",":0.211,"-":0.331,".":0.223,"/":0.415,"0":0.453,"1":0.284,"2":0.438,"3":0.436,"4":0.484,"5":0.439,"6":0.44,"7":0.407,"8":0.44,"9":0.435,":":0.275,";":0.232,"<":0.438,"=":0.438,">":0.438,"?":0.437,"@":0.759,"A":0.482,"B":0.47,"C":0.464,"D":0.476,"E":0.438,"F":0.421,"G":0.467,"H":0.48,"I":0.23,"J":0.452,"K":0.491,"L":0.426,"M":0.548,"N":0.514,"O":0.473,"P":0.465,"Q":0.461,"R":0.471,"S":0.444,"T":0.468,"U":0.479,"V":0.488,"W":0.689,"X":0.475,"Y":0.474,"Z":0.412,"[":0.345,"\\":0.415,"]":0.345,"^":0.422,"_":0.421,"`":0.22,"a":0.446,"b":0.445,"c":0.434,"d":0.445,"e":0.436,"f":0.298,"g":0.441,"h":0.447,"i":0.219,"j":0.217,"k":0.449,"l":0.209,"m":0.675,"n":0.447,"o":0.442,"p":0.448,"q":0.448,"r":0.324,"s":0.412,"t":0.291,"u":0.447,"v":0.436,"w":0.613,"x":0.439,"y":0.423,"z":0.373,"{":0.344,"|":0.186,"}":0.344,"~":0.49};

export const blueprint: Theme = {
  name: 'blueprint',
  W: 1080, H: 1280, fullH: 1920, fps: 30,
  safe: [48, 96, 1032, 1240],
  captionBox: [48, 104, 1032, 196],
  content: [48, 222, 1032, 1232],
  font: { family: 'BlueprintCond', stack: 'BlueprintCond, "Arial Narrow", "Roboto Condensed", sans-serif', cap: 0.7, adv: ADV },
  type: { label: 40, sub: 32, caption: 60, text: 36, stat: 120, minPx: 26 },
  roles: {
    gateway: '#ffb020', public: '#22d3ee', private: '#a78bfa', response: '#34d399', blocked: '#ff4d6d',
    external: '#c9d6ea', boundary: '#f2f7ff', neutral: '#9fb4d6', aws: '#ff9a3c', onprem: '#7dd3fc',
  },
  zoneFill: {
    public: '#0e7898', private: '#30296f', external: '#56698c', boundary: '#1a4d93', neutral: '#2f6aa8',
    aws: '#5a3a1a', onprem: '#14506e',
  },
  ink: '#061633', paper: '#f2f7ff', page: ['#0b2a5b', '#0e3a7a'],
  wordsPerSecond: 2.6,
  packetSpeed: 320,
  transition: 0.9,
  limits: { maxLabels: 16, maxSpeed: 2600, minCaption: 1.5 },
  nodeSizes: {
    server: { hw: 34, h: 34 }, gateway: { hw: 44, h: 40 }, vpngw: { hw: 40, h: 34 }, router: { hw: 50, h: 34 },
    vpc: { hw: 42, h: 22 }, datacenter: { hw: 38, h: 58 }, database: { hw: 30, h: 40 }, cloud: { hw: 44, h: 30 },
    users: { hw: 26, h: 56 }, firewall: { hw: 40, h: 34 },
  },
  dim: { map: 0.4, label: 0.6, zone: 0.55 },
};

export const THEMES: Record<string, Theme> = { blueprint };
