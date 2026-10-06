import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from '../web/vnccs/three.module.mjs';
import { retargetDuf } from '../web/editor/duf-import.mjs';
const bone = (name, parentName, headPos=[0,0,0], tailPos=[0,1,0]) => ({name,userData:{parentName,headPos,tailPos}});
const viewer = {THREE, boneList:[bone('Root',null),bone('pelvis','Root'),bone('spine_01','pelvis'),bone('spine_02','spine_01'),bone('spine_03','spine_02'),bone('clavicle_l','spine_03'),bone('upperarm_l','clavicle_l',[0,0,0],[1,0,0]),bone('lowerarm_l','upperarm_l',[1,0,0],[2,0,0])]};
const q = xyz => new THREE.Quaternion().setFromEuler(new THREE.Euler(...xyz.map(x=>x*Math.PI/180),'XYZ'));
const close = (a,b) => assert.ok(1-Math.abs(a.dot(b)) < 1e-8);
test('hip pivot remains fixed when target root is at the feet',()=>{
 const rig={...viewer,boneList:[bone('Root',null),bone('pelvis','Root',[0,10,0])]};
 const result=retargetDuf({channels:{hip:{z:90}}},rig);
 const hip=new THREE.Vector3(0,10,0).applyQuaternion(q(result.pose.bones.Root)).add(new THREE.Vector3(...result.translation));
 assert.ok(hip.distanceTo(new THREE.Vector3(0,10,0))<1e-9);
});
test('unnamed bend/twist preset defaults to G8 basis; explicit G3 stays distinct',()=>{
 const channels={lShldrBend:{y:25},lForearmBend:{y:35}};
 close(q(retargetDuf({channels},viewer).pose.bones.upperarm_l),q(retargetDuf({asset:'/Genesis8/Female',channels},viewer).pose.bones.upperarm_l));
});
test('figure rotation composes hip translation and centimetres convert to decimetres',()=>{
 const result=retargetDuf({channels:{__figure__:{y:90},hip:{x:0}},translations:{__figure__:{x:100,y:20},hip:{z:50}}},viewer);
 assert.ok(Math.abs(result.translation[0]-15)<1e-8);
 assert.ok(Math.abs(result.translation[1]-2)<1e-8);
 assert.ok(Math.abs(result.translation[2])<1e-8);
});
test('root rotation propagates once, not once per bone',()=>{
 const {pose} = retargetDuf({channels:{hip:{y:70}}},viewer);
 close(q(pose.bones.Root), q([0,70,0]));
 for(const name of ['pelvis','spine_01','spine_02','spine_03']) close(q(pose.bones[name]),q([0,0,0]));
});
test('bend and twist compose as rotations, not angle addition',()=>{
 const {pose} = retargetDuf({asset:'/Genesis3/Female',channels:{lShldrBend:{y:45},lShldrTwist:{x:60}}},viewer);
 close(q(pose.bones.upperarm_l), q([0,45,0]).multiply(q([60,0,0])));
});
test('pelvis tilt affects legs but does not tilt DAZ abdomen twice',()=>{
 const {pose} = retargetDuf({channels:{pelvis:{x:20},abdomenLower:{x:35}}},viewer);
 close(q(pose.bones.pelvis).multiply(q(pose.bones.spine_01)),q([35,0,0]));
});
test('honors embedded orientation and rotation order',()=>{
 const {pose}=retargetDuf({channels:{hip:{x:20,y:30,z:40}},metadata:{hip:{rotation_order:'ZXY',orientation:[{id:'z',value:90}]}}},viewer);
 const orient=q([0,0,90]);
 const expected=orient.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(20*Math.PI/180,30*Math.PI/180,40*Math.PI/180,'YXZ'))).multiply(orient.clone().invert());
 close(q(pose.bones.Root),expected);
});
test('unsupported skeleton fails without mutating viewer',()=>{
 assert.throws(()=>retargetDuf({channels:{customJoint:{x:10}}},viewer),/Genesis/);
});

test('G9 spine and two twist bones contribute to the arm',()=>{
 const {pose,count}=retargetDuf({channels:{spine1:{x:15},l_upperarm:{x:20},l_upperarmtwist1:{x:10},l_upperarmtwist2:{x:5}}},viewer);
 assert.equal(count,4);
 close(q(pose.bones.spine_01),q([15,0,0]));
 const orient=q([0,0,-45]);
 close(q(pose.bones.upperarm_l),orient.clone().multiply(q([35,0,0])));
});
test('G8 asset alias V8 gets the same rest pose as Genesis 8',()=>{
 const a=retargetDuf({asset:'/poses/05_V8.duf',channels:{lShldrBend:{x:25}}},viewer);
 const b=retargetDuf({asset:'/People/Genesis%208/Female',channels:{lShldrBend:{x:25}}},viewer);
 close(q(a.pose.bones.upperarm_l),q(b.pose.bones.upperarm_l));
});

test('traditional DAZ and Genesis 3 rigs keep their T-pose arm basis',()=>{
 const legacy=retargetDuf({channels:{lShldr:{z:25}}},viewer);
 const g3=retargetDuf({asset:'/Genesis%203/Female',channels:{lShldrBend:{z:25}}},viewer);
 close(q(legacy.pose.bones.upperarm_l),q([0,0,25]));
 close(q(g3.pose.bones.upperarm_l),q([0,0,25]));
});
test('partial G8 pose uses its generation even without bend channels',()=>{
 const partial=retargetDuf({asset:'/Genesis%208/Female',channels:{lCollar:{z:10}}},viewer);
 const full=retargetDuf({asset:'/Genesis%208/Female',channels:{lCollar:{z:10},lShldrBend:{x:0}}},viewer);
 close(q(partial.pose.bones.upperarm_l),q(full.pose.bones.upperarm_l));
});
