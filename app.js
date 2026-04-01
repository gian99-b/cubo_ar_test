import * as THREE from 'three';
import { ARButton } from 'three/addons/webxr/ARButton.js';

let camera, scene, renderer;
let controller, reticle, cube;

let hitTestSource = null;
let hitTestSourceRequested = false;

init();
animate();

function init() {
    const container = document.createElement('div');
    document.body.appendChild(container);

    scene = new THREE.Scene();

    camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 20);

    const light = new THREE.HemisphereLight(0xffffff, 0xbbbbff, 3);
    light.position.set(0.5, 1, 0.25);
    scene.add(light);

    // Setup Renderer per l'AR
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.xr.enabled = true; // FONDAMENTALE PER L'AR
    container.appendChild(renderer.domElement);

    // Creiamo il bottone magico. Il "dom-overlay" permette agli slider di essere cliccabili in AR!
    const arButton = ARButton.createButton(renderer, { 
        requiredFeatures: ['hit-test'],
        optionalFeatures: ['dom-overlay'],
        domOverlay: { root: document.body }
    });
    document.body.appendChild(arButton);

    // Creiamo il CUBO (1x1x1 metri base)
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshPhongMaterial({ color: 0x44aa88 });
    cube = new THREE.Mesh(geometry, material);
    cube.visible = false; // Nascondilo finché non clicchi sul pavimento
    cube.scale.set(0.2, 0.2, 0.2); // Scala iniziale: 20cm
    scene.add(cube);

    // Creiamo il MIRINO (Reticle)
    const reticleGeometry = new THREE.RingGeometry(0.15, 0.2, 32).rotateX(-Math.PI / 2);
    const reticleMaterial = new THREE.MeshBasicMaterial({ color: 0x00aaff });
    reticle = new THREE.Mesh(reticleGeometry, reticleMaterial);
    reticle.matrixAutoUpdate = false;
    reticle.visible = false;
    scene.add(reticle);

    // Gestione del TAP sullo schermo
    controller = renderer.xr.getController(0);
    controller.addEventListener('select', onSelect);
    scene.add(controller);

    // Gestione degli slider
    setupSliders();

    window.addEventListener('resize', onWindowResize);
}

// Funzione che deforma il cubo quando muovi gli slider
function setupSliders() {
    const w = document.getElementById('width');
    const h = document.getElementById('height');
    const d = document.getElementById('depth');

    function updateCube() {
        // Applica i valori degli slider alla scala del cubo
        cube.scale.set(parseFloat(w.value), parseFloat(h.value), parseFloat(d.value));
    }

    w.addEventListener('input', updateCube);
    h.addEventListener('input', updateCube);
    d.addEventListener('input', updateCube);
}

// Funzione chiamata quando fai TAP sul pavimento
function onSelect() {
    if (reticle.visible) {
        // Sposta il cubo dove si trova il mirino
        cube.position.setFromMatrixPosition(reticle.matrix);
        // E fallo apparire!
        cube.visible = true;
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

// Ciclo principale per far muovere il mirino sul pavimento
function render(timestamp, frame) {
    if (frame) {
        const referenceSpace = renderer.xr.getReferenceSpace();
        const session = renderer.xr.getSession();

        if (hitTestSourceRequested === false) {
            session.requestReferenceSpace('viewer').then(function (referenceSpace) {
                session.requestHitTestSource({ space: referenceSpace }).then(function (source) {
                    hitTestSource = source;
                });
            });
            session.addEventListener('end', function () {
                hitTestSourceRequested = false;
                hitTestSource = null;
            });
            hitTestSourceRequested = true;
        }

        if (hitTestSource) {
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