import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as T from '../web/vnccs/three.module.mjs';
import {transformGroup} from '../web/editor/scene-tools.mjs';
const source=fs.readFileSync(new URL('../web/editor/freepose.mjs',import.meta.url),'utf8');
test('vertical group turn rotates positions and orientations together',()=>{
 const chars=[{transform:{x:0,y:2,z:0,zoom:1},pose:{modelRotation:[0,0,0]}},{transform:{x:0,y:0,z:2,zoom:1},pose:{modelRotation:[0,0,0]}}];
 const result=transformGroup(T,chars,new T.Vector3(),{rotation:new T.Quaternion().setFromAxisAngle(new T.Vector3(1,0,0),Math.PI/2)});
 assert.ok(Math.abs(result[0].transform.z-2)<1e-9);
 assert.ok(Math.abs(result[1].transform.y+2)<1e-9);
 assert.ok(Math.abs(result[0].pose.modelRotation[0]-90)<1e-9);
});
test('individual turn sliders preserve other axes; group pitch uses incremental world X rotation',()=>{
 const callbacks={},viewer={THREE:T,modelRotation:{x:20,y:30,z:10},setModelRotation(x,y,z){this.modelRotation={x,y,z};}};
 const context={viewer,groupMode:false,groupState:{pitch:20},bindSlider:(id,fn)=>callbacks[id]=fn,$:id=>id,refreshControls(){},schedulePreview(){},toast(e){throw Error(e)},applyGroup(delta){context.delta=delta;}};
 const start=source.indexOf('const turnTo ='),end=source.indexOf("$('#hide-background').onchange");
 vm.runInNewContext(source.slice(start,end),context);
 callbacks['#pitch'](-180);assert.deepEqual(viewer.modelRotation,{x:-180,y:30,z:10});
 callbacks['#turn'](70);assert.deepEqual(viewer.modelRotation,{x:-180,y:70,z:10});
 context.groupMode=true;callbacks['#pitch'](50);
 assert.equal(context.groupState.pitch,50);
 const expected=new T.Quaternion().setFromAxisAngle(new T.Vector3(1,0,0),Math.PI/6);
 assert.ok(context.delta.rotation.angleTo(expected)<1e-7);
});
test('capture restores hidden editor background and still captures the original texture even on failure',()=>{
 const material={color:new T.Color(),emissiveIntensity:.025},plain={},texture={},viewer={scene:{background:plain},skinnedMesh:{material},passiveCharacters:new Map(),updateLights(){},capture(){assert.equal(this.scene.background,texture);return 'png';}};
 const context={viewer,backgroundTexture:texture,CAPTURE_LIGHTS:{},CAPTURE_BACKGROUND:'#fff',FRONT:{yaw:0,pitch:0},highlightCharacter(){}};
 vm.runInNewContext(source.slice(source.indexOf('function capture(width'),source.indexOf('function schedulePreview()')),context);
 assert.equal(context.capture(10,10),'png');assert.equal(viewer.scene.background,plain);
 viewer.capture=()=>{throw Error('capture failed')};assert.throws(()=>context.capture(10,10));assert.equal(viewer.scene.background,plain);
});
test('group-only mode keeps a world rotation gizmo and movement is an independent toggle',()=>{
 const controls={setMode(v){this.mode=v;},setSpace(v){this.space=v;},attach(v){this.object=v;},detach(){this.object=null;}};
 const proxy=new T.Object3D();
 const context={moveProxy:proxy,proxyRotation:null,groupMode:true,moveMode:false,groupState:{x:1,y:2,z:3},doc:{transform:{x:4,y:5,z:6}},floorLevel:0,viewer:{transform:controls}};
 vm.runInNewContext(source.slice(source.indexOf('function syncMoveProxy()'),source.indexOf("$('#group-mode').onclick")),context);
 context.syncMoveProxy();assert.equal(controls.mode,'rotate');assert.equal(controls.object,proxy);assert.deepEqual(proxy.position.toArray(),[1,2,3]);
 context.moveMode=true;context.syncMoveProxy();assert.equal(controls.mode,'translate');
 context.moveMode=false;context.syncMoveProxy();assert.equal(controls.mode,'rotate');
 context.groupMode=false;context.syncMoveProxy();assert.equal(controls.object,null);
});
test('import placement snapshot is independent of later scene edits',()=>{
 const characters=[{slot:1,transform:{x:1,y:2,z:3,zoom:1},pose:{modelRotation:[20,30,40]}},{slot:2,transform:{x:4,y:5,z:6,zoom:2},pose:{}}];
 const context={characters,structuredClone,storeCharacter(){},importPlacements:[]};
 vm.runInNewContext(source.slice(source.indexOf('function rememberImportPlacements()'),source.indexOf('function recordGroupState()')),context);
 context.rememberImportPlacements();characters[0].transform.x=40;characters[0].pose.modelRotation[0]=80;
 assert.equal(context.importPlacements[0].transform.x,1);assert.equal(context.importPlacements[0].modelRotation[0],20);
 assert.equal(context.importPlacements[1].modelRotation.join(','),'0,0,0');
});
test('background toggle immediately requests a render in both directions',()=>{
 const checkbox={checked:true},plain={},texture={};let draws=0;
 const context={$:()=>checkbox,plainBackground:plain,backgroundTexture:texture,viewer:{scene:{background:texture},requestRender(){draws++;}}};
 const start=source.indexOf("$('#hide-background').onchange =");
 vm.runInNewContext(source.slice(start,source.indexOf('\n};',start)+3),context);
 checkbox.onchange();assert.equal(context.viewer.scene.background,plain);assert.equal(draws,1);
 checkbox.checked=false;checkbox.onchange();assert.equal(context.viewer.scene.background,texture);assert.equal(draws,2);
});
test('saved pose capture excludes background while editor preview can retain it',()=>{
 const material={color:new T.Color(),emissiveIntensity:0},texture={};let background;
 const context={viewer:{scene:{background:texture},skinnedMesh:{material},passiveCharacters:new Map(),updateLights(){},capture(w,h,z,bg){background=bg;return 'png';}},backgroundTexture:texture,CAPTURE_LIGHTS:{},CAPTURE_BACKGROUND:'#fff',FRONT:{yaw:0,pitch:0},highlightCharacter(){}};
 vm.runInNewContext(source.slice(source.indexOf('function capture(width'),source.indexOf('function schedulePreview()')),context);
 context.capture(64,64,false);assert.equal(background,'#fff');
 context.capture(64,64);assert.equal(background,null);
 assert.equal(context.viewer.scene.background,texture);
});
