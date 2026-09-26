// DSON rotations -> MakeHuman local XYZ rotations. No DAZ assets are redistributed.
// Source world rotations are accumulated before collapsing bend/twist chains.
export function retargetDuf(data, viewer) {
    const T = viewer.THREE, rad = Math.PI / 180;
    const channels = Object.fromEntries(Object.entries(data.channels || {}).map(([k,v]) => [k.replace('Forearmtwist', 'forearmtwist'),v])), metadata = data.metadata || {};
    let asset = data.asset || '';
    try { asset = decodeURIComponent(asset); } catch { /* Some presets use literal percent signs. */ }
    const genesis9 = /Genesis ?9|G9[BFM_]/i.test(asset) || Object.keys(channels).some(k => /^(spine[1-4]|[lr]_(upperarm|thigh|forearm|hand|shin|foot|toes|thumb|index|mid|ring|pinky))/.test(k));
    const genesis8 = /(?:Genesis ?8|(?:^|[/_])V8(?:[_.]|$)|G8(?:\.1)?[FM_])/i.test(asset);
    const parents = {}, mapping = {}, order = {}, source = {};
    const define = (name, parent, target, rotationOrder = 'YZX') => {
        parents[name] = parent; order[name] = rotationOrder;
        if (target) mapping[target] = name;
    };
    define('__figure__', null);
    define('hip', '__figure__', 'Root');
    define('pelvis', 'hip', 'pelvis');
    define('abdomenLower', 'hip', 'spine_01');
    define('abdomenUpper', 'abdomenLower', 'spine_02');
    define('chestLower', 'abdomenUpper');
    define('chestUpper', 'chestLower', 'spine_03');
    define('neckLower', 'chestUpper');
    define('neckUpper', 'neckLower', 'neck_01');
    define('head', 'neckUpper', 'head');
    const legacy = !genesis9 && !genesis8 && !/Genesis ?3|G3[FM_]/i.test(asset) && !Object.keys(channels).some(k => /(?:Bend|Twist|abdomenLower|neckLower)/.test(k));
    if (legacy) {
        define('abdomen', 'hip', 'spine_01');
        define('abdomen2', 'abdomen', 'spine_02');
        define('chest', 'abdomen2', 'spine_03');
        define('neck', 'chest', 'neck_01');
        define('head', 'neck', 'head');
    }
    for (const side of ['l', 'r']) {
        const target = n => `${n}_${side}`;
        define(side + 'Collar', legacy ? 'chest' : 'chestUpper', target('clavicle'));
        define(side + 'ShldrBend', side + 'Collar', null, 'XYZ');
        define(side + 'ShldrTwist', side + 'ShldrBend', target('upperarm'), 'XYZ');
        define(side + 'ForearmBend', side + 'ShldrTwist', null, 'XYZ');
        define(side + 'ForearmTwist', side + 'ForearmBend', target('lowerarm'), 'XYZ');
        define(side + 'Hand', side + 'ForearmTwist', target('hand'), 'XYZ');
        define(side + 'ThighBend', 'pelvis', null, 'XZY');
        define(side + 'ThighTwist', side + 'ThighBend', target('thigh'), 'XZY');
        define(side + 'Shin', side + 'ThighTwist', target('calf'), 'XZY');
        define(side + 'Foot', side + 'Shin', target('foot'), 'XZY');
        define(side + 'Metatarsals', side + 'Foot', null, 'XZY');
        define(side + 'Toe', side + 'Metatarsals', target('ball'), 'XZY');
        if (legacy) {
            define(side + 'Shldr', side + 'Collar', target('upperarm'), 'XYZ');
            define(side + 'ForeArm', side + 'Shldr', target('lowerarm'), 'XYZ');
            define(side + 'Hand', side + 'ForeArm', target('hand'), 'XYZ');
            define(side + 'Thigh', 'pelvis', target('thigh'), 'XZY');
            define(side + 'Shin', side + 'Thigh', target('calf'), 'XZY');
        }
        for (const [finger, dst, carpal] of [['Thumb','thumb',0], ['Index','index',1], ['Mid','middle',2], ['Ring','ring',3], ['Pinky','pinky',4]]) {
            if (carpal) define(side + 'Carpal' + carpal, side + 'Hand', null, 'XYZ');
            for (let i = 1; i <= 3; i++) define(side + finger + i,
                i === 1 ? (carpal ? side + 'Carpal' + carpal : side + 'Hand') : side + finger + (i - 1),
                target(`${dst}_0${i}`), 'XYZ');
        }
    }
    if (genesis9) {
        define('spine1', 'hip', 'spine_01');
        define('spine2', 'spine1', 'spine_02');
        define('spine3', 'spine2');
        define('spine4', 'spine3', 'spine_03');
        define('neck1', 'spine4');
        define('neck2', 'neck1', 'neck_01');
        define('head', 'neck2', 'head');
        for (const side of ['l', 'r']) {
            const n = x => `${side}_${x}`, target = x => `${x}_${side}`;
            define(n('shoulder'), 'spine4', target('clavicle'));
            for (const [part, parent, dst, sequence] of [
                ['upperarm', n('shoulder'), 'upperarm', 'XYZ'],
                ['forearm', n('upperarmtwist2'), 'lowerarm', 'XYZ'],
                ['thigh', 'pelvis', 'thigh', 'XZY']]) {
                define(n(part), parent, null, sequence);
                define(n(part + 'twist1'), n(part), null, sequence);
                define(n(part + 'twist2'), n(part + 'twist1'), target(dst), sequence);
            }
            define(n('hand'), n('forearmtwist2'), target('hand'), 'XYZ');
            define(n('shin'), n('thightwist2'), target('calf'), 'XZY');
            define(n('foot'), n('shin'), target('foot'), 'XZY');
            define(n('metatarsal'), n('foot'), null, 'XZY');
            define(n('toes'), n('metatarsal'), target('ball'), 'XZY');
            for (const [finger, dst] of [['thumb','thumb'],['index','index'],['mid','middle'],['ring','ring'],['pinky','pinky']]) {
                if (finger !== 'thumb') define(n(finger + 'metacarpal'), n('hand'), null, 'XYZ');
                for (let i=1; i<=3; i++) define(n(finger+i), i>1 ? n(finger+(i-1)) : n(finger === 'thumb' ? 'hand' : finger+'metacarpal'), target(`${dst}_0${i}`), 'XYZ');
            }
        }
    }
    const recognized = Object.keys(channels).filter(k => Object.hasOwn(parents, k));
    if (!recognized.length) throw new Error('未识别到 Genesis 人体骨骼；请使用 Genesis 3、8、8.1、9 或传统 DAZ 人体姿势预设');
    const vec = entries => ['x','y','z'].map(axis => Number(entries?.find(e => e.id === axis)?.value || 0));
    const quaternion = (angles, sequence) => new T.Quaternion().setFromEuler(new T.Euler(...angles.map(v => v * rad), sequence));
    function world(name) {
        if (!name) return new T.Quaternion();
        if (source[name]) return source[name].clone();
        const m = metadata[name] || {}, a = channels[name] || {};
        const sequence = m.rotation_order || order[name];
        if (!['XYZ','YZX','ZYX','ZXY','XZY','YXZ'].includes(sequence)) throw new Error('无效 DAZ 旋转顺序');
        const isArm = /^(l|r)(Shldr|Forearm|Hand|Carpal|Thumb|Index|Mid|Ring|Pinky|_(upperarm|forearm|hand|thumb|index|mid|ring|pinky))/.test(name);
        const fallbackOrientation = (genesis8 || genesis9) && isArm ? [0, 0, name[0] === 'l' ? -45 : 45] : [0, 0, 0];
        const orientation = quaternion(m.orientation ? vec(m.orientation) : fallbackOrientation, 'XYZ');
        const local = orientation.clone().multiply(quaternion(['x','y','z'].map(k => a[k] || 0), sequence)).multiply(orientation.clone().invert());
        const q = world(parents[name]).multiply(local);
        source[name] = q.clone();
        return q;
    }
    const worlds = {}, bones = {};
    // G8 rest arms are 45 degrees down; G3/Genesis use a T pose. Match each
    // target segment in world space, then recover local rotations from its parent.
    for (const bone of viewer.boneList) {
        const name = mapping[bone.name];
        let q = name ? world(name) : new T.Quaternion();
        const arm = /^(upperarm|lowerarm|hand|(?:index|middle|ring|pinky|thumb)_0[123])_([lr])$/.exec(bone.name);
        if (arm) {
            const side = arm[2] === 'l' ? 1 : -1;
            const a = new T.Vector3(...bone.userData.headPos), b = new T.Vector3(...bone.userData.tailPos);
            const restDirection = b.sub(a).normalize();
            const m = metadata[name];
            const dir = m?.center_point && m?.end_point
                ? new T.Vector3(...vec(m.end_point)).sub(new T.Vector3(...vec(m.center_point))).normalize()
                : new T.Vector3(side * Math.cos((genesis8 || genesis9) ? Math.PI / 4 : 0), -Math.sin((genesis8 || genesis9) ? Math.PI / 4 : 0), 0);
            q.multiply(new T.Quaternion().setFromUnitVectors(restDirection, dir));
        }
        worlds[bone.name] = q.clone();
        const parent = worlds[bone.userData.parentName] || new T.Quaternion();
        const local = parent.clone().invert().multiply(q);
        const e = new T.Euler().setFromQuaternion(local, 'XYZ');
        const angles = [e.x / rad, e.y / rad, e.z / rad];
        if (!angles.every(Number.isFinite)) throw new Error('DUF 骨骼定义包含无效数字');
        bones[bone.name] = angles;
    }
    const ignored = Object.keys(channels).filter(k => !Object.hasOwn(parents, k));
    return { pose: { bones, modelRotation: [0, 0, 0] }, count: recognized.length,
        warning: `${Object.keys(metadata).length ? '已读取文件骨骼定义' : '采用 Genesis 默认骨架近似转移（预设未包含骨架定义）'}${ignored.length ? `；未映射 ${ignored.length} 个骨骼（如眼睛/面部）` : ''}` };
}
