"""
Regression test for OCR math formula normalization.

Usage:
  python -m app.test_math_formula_normalization
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.routes.convert import _post_process_ocr_text


def test_math_set_notation_normalization() -> None:
    sample = """
N  0,1,2,3,...: Tập hợp các số tự nhiên.
Z  ...,3,2,1,0,1,2,3,...: Tập hợp các số nguyên
a 
Q  , a  Z ,b  Z ,b  0 : Tập hợp các số hữu tỉ
 b 
R : Tập hợp các số thực
C  a  ib, a  R,b  R,i2  1 : Tập hợp các số phức
Và N  Z  Q  R  C .
""".strip()

    out = _post_process_ocr_text(sample)
    print("\n=== NORMALIZED OUTPUT ===\n")
    print(out)
    print("\n========================\n")

    assert r"$N = \{0,1,2,3,...\}$" in out
    assert r"$Z = \{...,-3,-2,-1,0,1,2,3,...\}$" in out
    assert r"$Q = \{\frac{a}{b}, a \in Z, b \in Z, b \ne 0\}$" in out
    assert "i^2 = -1" in out
    assert r"$C = a + ib" in out
    assert r"$N \subset Z \subset Q \subset R \subset C$" in out


if __name__ == "__main__":
    test_math_set_notation_normalization()
    print("MATH_FORMULA_NORMALIZATION_TEST_OK")
