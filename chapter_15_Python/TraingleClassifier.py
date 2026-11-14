# Triangle has 2 sides same - Isosceles
# Triangle has 3 sides same - Equilateral
# Triangle has all sides not same - Scalene

a, b, c = map(int,input().split())

if a==b and b==c:
    print("Equilateral")
elif a==b and b!=c:
    print("Isosceles")
else:
    print("Scalene")
