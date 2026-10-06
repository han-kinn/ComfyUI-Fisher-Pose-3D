import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const url = new URL('../web/fisher_pose.js', import.meta.url);
function extension(overrides = {}) {
    let registered;
    const code = fs.readFileSync(url, 'utf8').replace(/^import .*;$/gm, '')
        .replaceAll('import.meta.url', JSON.stringify(url.href));
    vm.runInNewContext(code, {URL, app:{registerExtension(value){registered=value;}}, api:{}, setTimeout(){}, ...overrides});
    return registered;
}
test('3D frontend has a unique extension registration',()=>{
    assert.equal(extension().name,'Fisher3D.PoseStudio');
});
test('3D frontend does not hook any original Fisher nodes',async()=>{
    for(const name of ['FisherPoseStudio','FisherQwenPose','FisherQwenFreePose','FisherQwen21GGUFCLIP']){
        class Node {}
        await extension().beforeRegisterNodeDef(Node,{name});
        assert.equal(Node.prototype.onNodeCreated,undefined);
        assert.equal(Node.prototype.onConfigure,undefined);
    }
});
test('3D nodes receive the correct editor button and private widget type',async()=>{
    for(const name of ['Fisher3DPoseStudio','Fisher3DQwenPose','Fisher3DQwenFreePose']){
        class Node { constructor(){ this.widgets=[{name:'pose_json'},{name:'scene_json'}];this.buttons=[];} addWidget(...args){const w={name:args[1],type:args[0]};this.buttons.push(args);this.widgets.push(w);return w;} }
        await extension().beforeRegisterNodeDef(Node,{name});
        const node=new Node();node.onNodeCreated();
        assert.equal(node.buttons.length,1);
        assert.equal(node.buttons[0][1],name==='Fisher3DQwenFreePose'?'打开自由姿势编辑器':'打开机位与姿态编辑器');
        assert.equal(node.widgets.filter(w=>w.hidden===true).length,1);
    }
});

test('editor button survives delayed widgets and repeated lifecycle hooks',async()=>{
    const ext=extension();
    class Node { constructor(){this.widgets=[];this.comfyClass='Fisher3DQwenFreePose';}
      addWidget(type,name){const w={type,name};this.widgets.push(w);return w;} }
    await ext.beforeRegisterNodeDef(Node,{name:'Fisher3DQwenFreePose'});
    const node=new Node();node.onNodeCreated();ext.nodeCreated(node);
    assert.equal(node.widgets.filter(w=>w.type==='button').length,1);
    node.widgets.push({name:'pose_json'});node.onConfigure();ext.loadedGraphNode(node);
    assert.equal(node.widgets.filter(w=>w.type==='button').length,1);
    assert.equal(node.widgets.find(w=>w.name==='pose_json').hidden,true);
    node.widgets=node.widgets.filter(w=>w.type!=='button');ext.loadedGraphNode(node);
    assert.equal(node.widgets.filter(w=>w.type==='button').length,1);
});

test('free-pose button opens its own 3D editor iframe',async()=>{
    const elements=[];
    const document={activeElement:null,body:{append(){}},createElement(tag){
      const element={tag,style:{},append(){},addEventListener(){},showModal(){this.open=true;}};
      elements.push(element);return element;
    }};
    const ext=extension({document,window:{addEventListener(){}},location:{origin:'http://localhost:8188'}});
    const node={type:'Fisher3DQwenFreePose',widgets:[{name:'pose_json',value:'{}'}],
      addWidget(type,name,value,callback){const w={type,name,callback};this.widgets.push(w);return w;}};
    ext.nodeCreated(node);
    node.widgets.find(w=>w.type==='button').callback();
    assert.match(elements.find(e=>e.tag==='iframe').src,/editor\/freepose\.html\?embedded=1&v=20261006-livebackground1$/);
    assert.equal(elements.find(e=>e.tag==='dialog').open,true);
});

test('hidden pose data does not keep an interactive DOM widget or negative layout height',()=>{
    const ext=extension();const scene={name:'pose_json',type:'customtext',value:'{"pose":42}',element:{style:{}},computeSize:()=>[300,80]};
    const node={type:'Fisher3DQwenFreePose',widgets:[scene],addWidget(type,name){const w={type,name};this.widgets.push(w);return w;}};
    ext.nodeCreated(node);
    assert.equal(scene.hidden,true);assert.equal(scene.type,'customtext');
    assert.equal(scene.element.style.pointerEvents,'none');assert.equal(scene.element.style.display,'none');
    assert.deepEqual(scene.computeSize(),[300,80]);assert.equal(scene.value,'{"pose":42}');
});

test('file input cancel cannot close its parent editor dialog',()=>{
 const elements=[];
 const document={activeElement:null,body:{append(){}},createElement(tag){
   const element={tag,style:{},listeners:{},append(){},addEventListener(type,fn){this.listeners[type]=fn;},showModal(){this.open=true;},close(){this.open=false;},remove(){this.removed=true;},click(){}};
   elements.push(element);return element;
 }};
 const ext=extension({document,window:{addEventListener(){},removeEventListener(){}},location:{origin:'http://localhost:8188'}});
 const node={type:'Fisher3DQwenFreePose',widgets:[{name:'pose_json',value:'{}'}],addWidget(type,name,value,callback){const w={type,name,callback};this.widgets.push(w);return w;}};
 ext.nodeCreated(node);node.widgets.find(w=>w.type==='button').callback();
 const dialog=elements.find(e=>e.tag==='dialog'), frame=elements.find(e=>e.tag==='iframe');
 frame.fisher3DChooseFiles(()=>{}, {accept:'.duf'});
 const picker=elements.at(-1);
 dialog.listeners.cancel({target:picker,preventDefault(){}});
 assert.equal(dialog.open,true);
 let stopped=false;picker.listeners.cancel({stopPropagation(){stopped=true;}});
 assert.equal(stopped,true);assert.equal(picker.removed,true);assert.equal(dialog.open,true);
 dialog.listeners.cancel({target:dialog,preventDefault(){}});
 assert.equal(dialog.open,false);
});


test('old free-pose nodes drop retired inputs and preserve remaining names and links', () => {
    const ext = extension();
    const names = ['clip','reference_image','reference_image_4','reference_image_2','reference_image_5','reference_image_3','background_image'];
    const node = {type:'Fisher3DQwenFreePose',widgets:[],inputs:names.map((name,i)=>({name,link:100+i})),removed:[],
        removeInput(i){this.removed.push(this.inputs[i].name);this.inputs.splice(i,1);},
        addWidget(type,name){const w={type,name};this.widgets.push(w);return w;}};
    ext.loadedGraphNode(node);ext.loadedGraphNode(node);
    assert.deepEqual(node.inputs.map(i=>i.name), ['clip','reference_image','reference_image_2','reference_image_3','background_image']);
    assert.deepEqual(node.inputs.map(i=>i.link), [100,101,103,105,106]);
    assert.deepEqual(node.inputs.slice(1).map(i=>i.label), ['参考图1','参考图2','参考图3','参考图4 背景']);
    assert.deepEqual(node.removed, ['reference_image_5','reference_image_4']);
    const original={...node,type:'FisherQwenFreePose',inputs:[{name:'reference_image_4',link:77}],removed:[]};
    ext.loadedGraphNode(original);
    assert.equal(original.inputs.length,1);assert.equal(original.inputs[0].link,77);
});

test('applying reset preserves every input link and prompt while restoring dimensions',()=>{
 const elements=[];let receive;
 const document={activeElement:null,body:{append(){}},createElement(tag){const e={tag,style:{},contentWindow:{},append(){},addEventListener(){},showModal(){},close(){},remove(){}};elements.push(e);return e;}};
 let ext;
 const app={registerExtension(x){ext=x;},graph:{change(){}}};
 extension({app,document,window:{addEventListener(type,fn){receive=fn;},removeEventListener(){}},location:{origin:'http://localhost'}});
 const node={type:'Fisher3DQwenFreePose',widgets:['pose_json','extra_prompt','width','height','reference_resolution'].map(name=>({name,value:512})),
 inputs:['clip','vae','reference_image','reference_image_2','reference_image_3','background_image','width','height'].map((name,i)=>({name,link:i+10})),
 disconnectInput(i){this.inputs[i].link=null;},setDirtyCanvas(){},addWidget(type,name,value,callback){const w={type,name,callback};this.widgets.push(w);return w;}};
 ext.nodeCreated(node);node.widgets.find(w=>w.type==='button').callback();
 receive({origin:'http://localhost',source:elements.find(e=>e.tag==='iframe').contentWindow,data:{type:'fisher-3d-apply',payload:{pose_json:'{}',extra_prompt:'keep the outfit, soft studio light',resetInputs:true}}});
 assert.deepEqual(node.inputs.map(i=>i.link),[10,11,12,13,14,15,16,17]);
 assert.equal(node.widgets.find(w=>w.name==='extra_prompt').value,'keep the outfit, soft studio light');
 for(const name of ['width','height','reference_resolution'])assert.equal(node.widgets.find(w=>w.name===name).value,1024);
});
