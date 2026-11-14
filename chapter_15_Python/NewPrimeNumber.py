for n in range(2, 201):

    is_prime = True

    for i in range(2, n):
        if n % i == 0:
            is_prime = False
            break

    if is_prime:
        print(n, end=" ")


n=2

while n<=100:

    is_prime = True

    i=2

    while i<n:
        if n%i == 0 :
            is_prime = False
            break
        i+=1

    if is_prime:
            print(n, end=" ")

    n+=1