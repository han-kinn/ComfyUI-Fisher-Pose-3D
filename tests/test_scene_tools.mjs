import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../web/vnccs/three.module.mjs';
import { bakeSceneView, transformGroup } from '../web/editor/scene-tools.mjs';
test('group scale and rotation preserve relative proportions about shared pivot',()=>{
 const cs=[{slot:1,transform:{x:-2,y:1,z:0,zoom:1},pose:{}},{slot:2,transform:{x:2,y:1,z:0,zoom:2},pose:{}}];
 const copy=structuredClone(cs);
 const result=transformGroup(T,cs,new T.Vector3(0,1,0),{scale:1.5,rotation:new T.Quaternion().setFromAxisAngle(new T.Vector3(0,1,0),Math.PI/2),translation:new T.Vector3(5,2,1)});
 assert.deepEqual(cs,copy);
 assert.ok(Math.abs(result[0].transform.z-4)<1e-9);
 assert.ok(Math.abs(result[1].transform.z+2)<1e-9);
 assert.equal(result[0].transform.zoom,1.5);assert.equal(result[1].transform.zoom,3);
 assert.throws(()=>transformGroup(T,cs,new T.Vector3(),{scale:10}),/范围/);
});
test('baked view preserves projection and pairwise distances for all characters',()=>{
    const source=new T.PerspectiveCamera(30,1,0.1,500),target=new T.PerspectiveCamera(30,1,0.1,500);
    source.position.set(12,7,22);source.lookAt(0,2,0);target.position.set(0,2,30);target.lookAt(0,2,0);
    source.updateMatrixWorld(true);target.updateMatrixWorld(true);
    const chars=[{slot:1,transform:{x:-2,y:0,z:1,zoom:1},pose:{modelRotation:[10,30,0]}},{slot:2,transform:{x:3,y:1,z:-2,zoom:1},pose:{modelRotation:[0,0,0]}}];
    const baked=bakeSceneView(T,source,target,chars);
    for(let i=0;i<2;i++){
        const transform=c=>new T.Matrix4().compose(new T.Vector3(c.transform.x,c.transform.y,c.transform.z),new T.Quaternion().setFromEuler(new T.Euler(...c.pose.modelRotation.map(v=>v*Math.PI/180))),new T.Vector3(1,1,1));
        for(const point of [[0,0,0],[1,2,3],[-1,5,-2]]){
            const before=new T.Vector3(...point).applyMatrix4(transform(chars[i])).project(source);
            const after=new T.Vector3(...point).applyMatrix4(transform(baked[i])).project(target);
            assert.ok(before.distanceTo(after)<1e-9);
        }
    }
    const distance=cs=>new T.Vector3(cs[0].transform.x,cs[0].transform.y,cs[0].transform.z).distanceTo(new T.Vector3(cs[1].transform.x,cs[1].transform.y,cs[1].transform.z));
    assert.ok(Math.abs(distance(chars)-distance(baked))<1e-9);
});
