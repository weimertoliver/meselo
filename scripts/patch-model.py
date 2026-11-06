"""Imre hangmodelljének kiegészítése: hangonkénti hosszszorzó bemenet ('dur_scale').

A VITS a hangok hosszát (w) a Ceil művelet előtt számolja: w_ceil = ceil(exp(logw) * x_mask * length_scale).
A Ceil elé beszúrunk egy szorzást egy új, [1, 1, T] alakú bemenettel, így a kettős mássalhangzók
(és bármely hang) hosszát egyenként lehet állítani. Csupa 1-es szorzóval a kimenet változatlan.
"""
import sys
import onnx
from onnx import helper, TensorProto

src, dst = sys.argv[1], sys.argv[2]
m = onnx.load(src)
g = m.graph
ceils = [n for n in g.node if n.op_type == 'Ceil']
assert len(ceils) == 1, f'{len(ceils)} Ceil csomópont'
ceil = ceils[0]
w_in = ceil.input[0]
g.input.append(helper.make_tensor_value_info('dur_scale', TensorProto.FLOAT, [1, 1, 'phonemes']))
mul = helper.make_node('Mul', [w_in, 'dur_scale'], ['w_scaled_by_dur'], name='DurScaleMul')
idx = list(g.node).index(ceil)
g.node.insert(idx, mul)
ceil.input[0] = 'w_scaled_by_dur'
# a sherpa-onnx által hozzáadott metaadatok között ismétlődő kulcs is van: az utolsót tartjuk meg
props = {}
for kv in m.metadata_props:
    props[kv.key] = kv.value
del m.metadata_props[:]
for k, val in props.items():
    m.metadata_props.add(key=k, value=val)
onnx.checker.check_model(m)
onnx.save(m, dst)
print('kész:', dst, '| Ceil bemenete volt:', w_in)
