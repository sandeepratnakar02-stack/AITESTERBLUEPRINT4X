import sys
lines = sys.stdin.read().split('\n')
s1 = lines[0] if len(lines) > 0 else ''
s2 = lines[1] if len(lines) > 1 else ''


if len(s1)!= len(s2):
    print("NO")
else:
    is_anagram = True

    for ch in s1:
        if s1.count(ch)!= s2.count(ch):
            is_anagram = False
            break

    if is_anagram:
        print("YES")
    else:
        print("NO")