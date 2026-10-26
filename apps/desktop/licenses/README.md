# ONNX Runtime notices

The locked `onnxruntime-node` and `onnxruntime-common` 1.30.0 npm distributions omit their
license files. `tools.mjs` stages these unchanged upstream files beside both packages:

- [LICENSE, v1.30.0](https://github.com/microsoft/onnxruntime/blob/v1.30.0/LICENSE)
- [ThirdPartyNotices.txt, v1.30.0](https://github.com/microsoft/onnxruntime/blob/v1.30.0/ThirdPartyNotices.txt)

Retrieved 2026-09-28. Update these with the ONNX Runtime dependency version. Licenses supplied
by Transformers, Sharp and their other runtime dependencies are copied from those packages.
