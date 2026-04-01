import * as THREE from 'three';
import { ARButton } from 'three/addons/webxr/ARButton.js';
import { SUBTRACTION, Brush, Evaluator } from 'three-bvh-csg';

let camera, scene, renderer, controller, reticle;
let evaluator, roomBrush, doorBrush, resultMesh;

// Parametri iniziali (Modellino in scala)
let params = { width: 0.5, height: 0.4, depth: 0.5, doorPos: 0 };
let scenePlaced = false;

init();
animate();

function init() {
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 20);

    const light = new THREE.HemisphereLight(0xffffff, 0xbbbbff, 3);
    scene.add(light);

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.xr.enabled = true;
    document.body.appendChild(renderer.domElement);

    document.body.appendChild(ARButton.createButton(renderer, { 
        requiredFeatures: ['hit-test'],
        optionalFeatures: ['dom-overlay'],
        domOverlay: { root: document.body }
    }));

    // --- SETUP CSG ---
    evaluator = new Evaluator();
    const roomMat = new THREE.MeshPhongMaterial({ color: 0x44aa88, opacity: 0.6, transparent: true, side: THREE.DoubleSide });
    
    // Stanza base
    roomBrush = new Brush(new THREE.BoxGeometry(1, 1, 1), roomMat);
    roomBrush.geometry.translate(0, 0.5, 0); 
    roomBrush.visible = false;
    scene.add(roomBrush);

    // Porta rossa (Il Taglierino)
    const doorMat = new THREE.MeshBasicMaterial({ color: 0xff0000, wireframe: true });
    doorBrush = new Brush(new THREE.BoxGeometry(0.12, 1, 0.1), doorMat); // Altezza 1 di base, scaleremo dopo
    doorBrush.geometry.translate(0, 0.5, 0);
    doorBrush.visible = false;
    scene.add(doorBrush);

    // Mesh finale
    resultMesh = new THREE.Mesh(new THREE.BufferGeometry(), roomMat);
    resultMesh.visible = false;
    scene.add(resultMesh);

    // Mirino AR
    reticle = new THREE.Mesh(
        new THREE.RingGeometry(0.1, 0.12, 32).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: 0x00ff00 })
    );
    reticle.matrixAutoUpdate = false;
    reticle.visible = false;
    scene.add(reticle);

    controller = renderer.xr.getController(0);
    controller.addEventListener('select', onSelect);

    setupUI();
    updateShapes();

    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });
}

function updateShapes() {
    // Aggiorna scala stanza
    roomBrush.scale.set(params.width, params.height, params.depth);
    
    // Aggiorna posizione e proporzione porta
    updateDoorPosition();
}

function updateDoorPosition() {
    const w = params.width;
    const d = params.depth;
    const h = params.height;
    const perimetro = (w + d) * 2;
    const dist = params.doorPos * perimetro;

    let x, z, angle;

    // Logica di scorrimento sui 4 lati
    if (dist <= w) { // Lato A
        x = dist - w/2; z = d/2; angle = 0;
    } else if (dist <= w + d) { // Lato B
        x = w/2; z = d/2 - (dist - w); angle = Math.PI / 2;
    } else if (dist <= 2*w + d) { // Lato C
        x = w/2 - (dist - (w+d)); z = -d/2; angle = Math.PI;
    } else { // Lato D
        x = -w/2; z = -d/2 + (dist - (2*w+d)); angle = -Math.PI / 2;
    }

    doorBrush.position.set(x, 0, z);
    doorBrush.rotation.y = angle;

    // La porta è sempre alta metà del cubo e larga 12cm (fissa per modellino)
    doorBrush.scale.set(1, h / 2, 1);
}

function performCut() {
    if (!scenePlaced) return;
    roomBrush.updateMatrixWorld(true);
    doorBrush.updateMatrixWorld(true);

    // Taglio
    evaluator.evaluate(roomBrush, doorBrush, SUBTRACTION, resultMesh);
    
    // Per tagli multipli: la stanza diventa il risultato attuale
    roomBrush.geometry.dispose();
    roomBrush.geometry = resultMesh.geometry.clone();
    
    resultMesh.visible = true;
    roomBrush.visible = false;
    
    resultMesh.position.copy(roomBrush.position);
}

function setupUI() {
    ['width', 'height', 'depth', 'doorPos'].forEach(id => {
        document.getElementById(id).addEventListener('input', (e) => {
            params[id] = parseFloat(e.target.value);
            if (!resultMesh.visible) updateShapes();
            else updateDoorPosition();
        });
    });

    document.getElementById('intersectBtn').addEventListener('click', performCut);
    
    document.getElementById('resetBtn').addEventListener('click', () => {
        roomBrush.geometry.dispose();
        roomBrush.geometry = new THREE.BoxGeometry(1, 1, 1);
        roomBrush.geometry.translate(0, 0.5, 0);
        roomBrush.visible = true;
        resultMesh.visible = false;
        updateShapes();
    });
}

function onSelect() {
    if (reticle.visible && !scenePlaced) {
        const pos = new THREE.Vector3().setFromMatrixPosition(reticle.matrix);
        roomBrush.position.copy(pos);
        resultMesh.position.copy(pos); 
        roomBrush.visible = true;
        doorBrush.visible = true;
        scenePlaced = true;
        reticle.visible = false;
    }
}

function animate() {
    renderer.setAnimationLoop(render);
}

function render(timestamp, frame) {
    if (frame && !scenePlaced) {
        const referenceSpace = renderer.xr.getReferenceSpace();
        const session = renderer.xr.getSession();
        session.requestReferenceSpace('viewer').then(refViewer => {
            session.requestHitTestSource({ space: refViewer }).then(source => {
                const results = frame.getHitTestResults(source);
                if (results.length > 0) {
                    const hit = results[0];
                    reticle.visible = true;
                    reticle.matrix.fromArray(hit.getPose(referenceSpace).transform.matrix);
                } else { reticle.visible = false; }
            });
        });
    }
    renderer.render(scene, camera);
}