// Bake a camera change into every model with one rigid world transform.
// Pairwise distances are preserved, and the original camera produces the same view.
export function transformGroup(T, characters, pivot, delta = {}) {
    const rotation = delta.rotation || new T.Quaternion(), scale = delta.scale ?? 1;
    const shift = delta.translation || new T.Vector3();
    return characters.map(character => {
        const c = structuredClone(character), t = c.transform;
        const p = new T.Vector3(t.x,t.y,t.z).sub(pivot).multiplyScalar(scale).applyQuaternion(rotation).add(pivot).add(shift);
        const zoom = t.zoom * scale;
        if (![p.x,p.y,p.z,zoom].every(Number.isFinite) || Math.abs(p.x)>50 || Math.abs(p.y)>50 || Math.abs(p.z)>40 || zoom<0.1 || zoom>7)
            throw new Error('整体调整超出范围，请减小调整幅度');
        const q = new T.Quaternion().setFromEuler(new T.Euler(...(c.pose?.modelRotation || [0,0,0]).map(v=>v*Math.PI/180)));
        const e = new T.Euler().setFromQuaternion(rotation.clone().multiply(q));
        c.transform = {...t,x:p.x,y:p.y,z:p.z,zoom};
        c.pose = {...c.pose,modelRotation:[e.x,e.y,e.z].map(v=>v*180/Math.PI)};
        return c;
    });
}

export function bakeSceneView(T, viewCamera, outputCamera, characters) {
    if (Math.abs(viewCamera.fov - outputCamera.fov) > 0.001 || Math.abs(viewCamera.zoom - outputCamera.zoom) > 0.001)
        throw new Error('请先回到正面视角，再使用编辑球调整视角');
    viewCamera.updateMatrixWorld(true); outputCamera.updateMatrixWorld(true);
    const rotation = outputCamera.quaternion.clone().multiply(viewCamera.quaternion.clone().invert());
    return characters.map(character => {
        const c = structuredClone(character), t = c.transform;
        const position = new T.Vector3(t.x, t.y, t.z).sub(viewCamera.position).applyQuaternion(rotation).add(outputCamera.position);
        if (Math.abs(position.x) > 50 || Math.abs(position.y) > 50 || Math.abs(position.z) > 40)
            throw new Error('当前视角超出场景范围，请拉近视角后重试');
        const angles = c.pose?.modelRotation || [0, 0, 0];
        const q = new T.Quaternion().setFromEuler(new T.Euler(...angles.map(v => v * Math.PI / 180), 'XYZ'));
        const e = new T.Euler().setFromQuaternion(rotation.clone().multiply(q), 'XYZ');
        c.transform = {...t, x:position.x, y:position.y, z:position.z};
        c.pose = {...c.pose, modelRotation:[e.x, e.y, e.z].map(v => v * 180 / Math.PI)};
        return c;
    });
}
