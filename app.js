import * as THREE from 'three';
import { ARButton } from 'three/addons/webxr/ARButton.js';
import { SUBTRACTION, Brush, Evaluator } from 'three-bvh-csg';

let camera, scene, renderer;
let controller, reticle;

let evaluator;
let roomBrush, doorBrush, resultMesh;

// PARAMETRI SCALA RIDOTTA
let params = { width: 0.5, height: 0.3, depth: 0.5, doorPos: 0 };

let hitTestSource = null;
let hitTestSourceRequested = false;
let scenePlaced = false;

init();
animate();

function init() {
    const container = document.createElement('div');
    document.body.appendChild(container);

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 20);

    const light = new THREE.HemisphereLight(0xffffff, 0xbbbbff, 3);
    scene.add(light);

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.xr.enabled = true;
    container.appendChild(renderer.domElement);

    // BOTTONE AR
    document.body.appendChild(ARButton.createButton(renderer, { 
        requiredFeatures: ['hit-test'],
        optionalFeatures: ['dom-overlay'],
        domOverlay: { root: document.body }
    }));

    // --- SETUP CSG ---
    evaluator = new Evaluator();
    
    const roomMat = new THREE.MeshPhongMaterial({ color: 0x44aa88, opacity: 0.6, transparent: true, side: THREE.DoubleSide });
    roomBrush = new Brush(new THREE.BoxGeometry(1, 1, 1), roomMat);
    roomBrush.geometry.translate(0, 0.5, 0); 
    roomBrush.visible = false;
    scene.add(roomBrush);

    // PORTA ROSSA (Deve essere visibile subito!)
    const doorMat = new THREE.MeshBasicMaterial({ color: 0xff0000, wireframe: true });
    doorBrush = new Brush(new THREE.BoxGeometry(0.12, 0.2, 0.1), doorMat);
    doorBrush.geometry.translate(0, 0.5, 0);
    doorBrush.visible = false;
    scene.add(doorBrush);

    resultMesh = new THREE.Mesh(new THREE.BufferGeometry(), roomMat);
    resultMesh.visible = false;
    scene.add(resultMesh);

    // --- SETUP MIRINO (Cerchio Blu) ---
    const reticleGeometry = new THREE.RingGeometry(0.15, 0.2, 32).rotateX(-Math.PI / 2);
    reticle = new THREE.Mesh(reticleGeometry, new THREE.MeshBasicMaterial({ color: 0x00aaff }));
    reticle.matrixAutoUpdate = false;
    reticle.visible = false;
    scene.add(reticle);

    controller = renderer.xr.getController(0);
    controller.addEventListener('select', onSelect);
    scene.add(controller);

    setupSliders();
    updateShapes(); 

    window.addEventListener('resize', onWindowResize);
}

function updateShapes() {
    roomBrush.scale.set(params.width, params.height, params.depth);
    // Porta alta la metà del cubo
    doorBrush.scale.set(1, (params.height / 2) / 0.2, 1); 
    updateDoorPosition();
}

function updateDoorPosition() {
    const w = params.width;
    const d = params.depth;
    const perimetro = (w + d) * 2;
    let dist = (params.doorPos / 100) * perimetro;

    let x, z, angle;

    if (dist <= w) { 
        x = dist - w/2; z = d/2; angle = 0;
    } else if (dist <= w + d) { 
        x = w/2; z = d/2 - (dist - w); angle = Math.PI / 2;
    } else if (dist <= 2*w + d) { 
        x = w/2 - (dist - (w+d)); z = -d/2; angle = Math.PI;
    } else { 
        x = -w/2; z = -d/2 + (dist - (2*w+d)); angle = -Math.PI / 2;
    }

    doorBrush.position.set(x, 0, z);
    doorBrush.rotation.y = angle;
}

function performCut() {
    if (!scenePlaced) return;
    roomBrush.updateMatrixWorld(true);
    doorBrush.updateMatrixWorld(true);
    evaluator.evaluate(roomBrush, doorBrush, SUBTRACTION, resultMesh);
    
    // Aggiorna la stanza con il taglio permanente
    roomBrush.geometry.dispose();
    roomBrush.geometry = resultMesh.geometry.clone();
    
    resultMesh.visible = true;
    roomBrush.visible = false;
    resultMesh.position.copy(roomBrush.position);
}

function setupSliders() {
    const ids = ['width', 'height', 'depth', 'doorPos'];
    ids.forEach(id => {
        document.getElementById(id).addEventListener('input', (e) => {
            params[id] = parseFloat(e.target.value);
            updateShapes();
            // Se abbiamo già tagliato, ricalcoliamo il taglio se cambiamo dimensioni
            if(resultMesh.visible && id !== 'doorPos') performCut();
        });
    });
    document.getElementById('intersectBtn').addEventListener('click', performCut);
}

function onSelect() {
    if (reticle.visible) {
        // Prendi la posizione dal mirino blu
        const pos = new THREE.Vector3().setFromMatrixPosition(reticle.matrix);
        
        // Sposta sia la stanza che il risultato del taglio nella nuova posizione
        roomBrush.position.copy(pos);
        resultMesh.position.copy(pos); 
        
        // Rendi tutto visibile
        roomBrush.visible = true;
        doorBrush.visible = true;
        
        // Segna che la scena è stata piazzata (serve per attivare i tagli)
        scenePlaced = true;
        
        console.log("Cubo spostato a:", pos);
    }
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
    renderer.setAnimationLoop(render);
}

function render(timestamp, frame) {
    if (frame) {
        const referenceSpace = renderer.xr.getReferenceSpace();
        const session = renderer.xr.getSession();

        if (hitTestSourceRequested === false) {
            session.requestReferenceSpace('viewer').then((refSpace) => {
                session.requestHitTestSource({ space: refSpace }).then((source) => {
                    hitTestSource = source;
                });
            });
            hitTestSourceRequested = true;
        }

        if (hitTestSource && !scenePlaced) {
            const hitTestResults = frame.getHitTestResults(hitTestSource);
            if (hitTestResults.length > 0) {
                const hit = hitTestResults[0];
                reticle.visible = true;
                reticle.matrix.fromArray(hit.getPose(referenceSpace).transform.matrix);
            } else {
                reticle.visible = false;
            }
        }
    }
    renderer.render(scene, camera);
}